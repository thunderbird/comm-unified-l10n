/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { XPCOMUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

ChromeUtils.defineESModuleGetters(this, {
  DisplayNameUtils: "resource:///modules/DisplayNameUtils.sys.mjs",
  Gloda: "resource:///modules/gloda/Gloda.sys.mjs",
  MessageArchiver: "resource:///modules/MessageArchiver.sys.mjs",
  MsgHdrToMimeMessage: "resource:///modules/gloda/MimeMessage.sys.mjs",
  PluralStringFormatter: "resource:///modules/TemplateUtils.sys.mjs",
  TagUtils: "resource:///modules/TagUtils.sys.mjs",
  UIDensity: "resource:///modules/UIDensity.sys.mjs",
  UIFontSize: "resource:///modules/UIFontSize.sys.mjs",
  makeFriendlyDateAgo: "resource:///modules/TemplateUtils.sys.mjs",
  mimeMsgToContentSnippetAndMeta:
    "resource:///modules/gloda/GlodaContent.sys.mjs",
});

var gMessenger = Cc["@mozilla.org/messenger;1"].createInstance(Ci.nsIMessenger);

// Set up our string formatter for localizing strings.
ChromeUtils.defineLazyGetter(this, "formatString", function () {
  const formatter = new PluralStringFormatter(
    "chrome://messenger/locale/multimessageview.properties"
  );
  return function (...args) {
    return formatter.get(...args);
  };
});

const lazy = {};
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "isConversationView",
  "mail.thread.conversation.enabled",
  false
);

window.addEventListener("DOMContentLoaded", event => {
  if (event.target != document) {
    return;
  }

  UIDensity.registerWindow(window);
  UIFontSize.registerWindow(window);
});

/**
 * A LimitIterator is a utility class that allows limiting the maximum number
 * of items to iterate over.
 */
class LimitIterator {
  /**
   *
   * @param {any[]} aArray - The array to iterate over (can be anything with a
   *   .length property and a subscript operator.
   * @param {int} aMaxLength - The maximum number of items to iterate over.
   */
  constructor(aArray, aMaxLength) {
    this._array = aArray;
    this._maxLength = aMaxLength;
  }

  /**
   * Iterate over the array until we hit the end or the maximum length,
   * whichever comes first.
   */
  *[Symbol.iterator]() {
    const length = this.length;
    for (let i = 0; i < length; i++) {
      yield this._array[i];
    }
  }

  /**
   * Returns true if the iterator won't actually iterate over everything in the
   * array.
   */
  get limited() {
    return this._array.length > this._maxLength;
  }

  /**
   * Returns the number of elements that will actually be iterated over.
   */
  get length() {
    return Math.min(this._array.length, this._maxLength);
  }

  /**
   * Returns the real number of elements in the array.
   */
  get trueLength() {
    return this._array.length;
  }
}

/**
 * The MultiMessageSummary class is responsible for populating the message pane
 * with a reasonable summary of a set of messages.
 */
class MultiMessageSummary {
  constructor() {
    this._summarizers = {};
  }
  /**
   * The maximum number of messages to examine in any way.
   */
  kMaxMessages = 10000;

  /**
   * Register a summarizer for a particular type of message summary.
   *
   * @param {ThreadSummarizer|MultipleSelectionSummarizer} aSummarizer - The summarizer object.
   */
  registerSummarizer(aSummarizer) {
    this._summarizers[aSummarizer.name] = aSummarizer;
    aSummarizer.onregistered(this);
  }

  /**
   * Store a mapping from a message header to the summary node in the DOM. We
   * use this to update things when Gloda tells us to.
   *
   * @param {nsIMsgDBHdr} aMsgHdr - The nsIMsgDBHdr.
   * @param {Node} aNode - The related DOM node.
   */
  mapMsgToNode(aMsgHdr, aNode) {
    const key = aMsgHdr.messageKey + aMsgHdr.folder.URI;
    this._msgNodes[key] = aNode;
  }

  /**
   * Clear all the content from the summary.
   */
  clear() {
    this._selectCallback = null;
    this._listener = null;
    this._glodaQuery = null;
    this._msgNodes = {};

    // Clear the messages list.
    const messageList = document.getElementById("messageList");
    messageList.replaceChildren();

    // Clear the notice.
    document.getElementById("notice").textContent = "";
  }

  _archiveBtnClickHandler = event => {
    if (event.button == 0) {
      window.browsingContext.topChromeWindow.goDoCommand("cmd_archive");
    }
  };

  _trashBtnClickHandler = event => {
    if (event.button == 0) {
      window.browsingContext.topChromeWindow.goDoCommand(
        event.shiftKey && event.target.dataset.imapDeleted == "false"
          ? "cmd_shiftDelete"
          : "cmd_delete"
      );
    }
  };

  /**
   * Fill in the summary pane describing the selected messages.
   *
   * @param {string} aType - The type of summary to perform (e.g. 'multimessage').
   * @param {nsIMsgDBHdr[]} aMessages - The messages to summarize.
   * @param {nsIMsgDBView} aDBView - The current DB view.
   * @param {function(nsIMsgDBHdr[]):void} aSelectCallback - Called with an
   *   array of messages when one of a summarized message is clicked on.
   * @param {Function} [aListener] A listener to be notified when the summary
   *   starts and finishes.
   */
  summarize(aType, aMessages, aDBView, aSelectCallback, aListener) {
    this.clear();

    this._selectCallback = aSelectCallback;
    this._listener = aListener;
    if (this._listener) {
      this._listener.onLoadStarted();
    }

    const archiveBtn = document.getElementById("hdrArchiveButton");
    archiveBtn.hidden = !MessageArchiver.canArchive(aMessages);
    archiveBtn.addEventListener("click", this._archiveBtnClickHandler);

    const trashBtn = document.getElementById("hdrTrashButton");
    trashBtn.addEventListener("click", this._trashBtnClickHandler);
    const areIMAPDeleted = aDBView
      ?.getSelectedMsgHdrs()
      .every(msg => msg.flags & Ci.nsMsgMessageFlags.IMAPDeleted);
    document.l10n.setAttributes(
      trashBtn,
      areIMAPDeleted
        ? "multi-message-undelete-button"
        : "multi-message-delete-button"
    );
    trashBtn.dataset.imapDeleted = !!areIMAPDeleted;

    headerToolbarNavigation.init();
    headerToolbarNavigation.updateRovingTab();

    const summarizer = this._summarizers[aType];
    if (!summarizer) {
      throw new Error('Unknown summarizer "' + aType + '"');
    }

    const messages = new LimitIterator(aMessages, this.kMaxMessages);
    const summarizedMessages = summarizer.summarize(messages, aDBView);

    // Stash somewhere so it doesn't get GC'ed.
    this._glodaQuery = Gloda.getMessageCollectionForHeaders(
      summarizedMessages,
      this
    );
    this._computeSize(messages);
  }

  /**
   * Set the heading for the summary.
   *
   * @param {string} title - The title for the heading.
   * @param {string} subtitle - A smaller subtitle for the heading.
   */
  setHeading(title, subtitle) {
    const titleNode = document.getElementById("summaryTitle");
    const subtitleNode = document.getElementById("summarySubtitle");
    titleNode.textContent = title || "";
    subtitleNode.textContent = subtitle || "";
  }

  /**
   * Create a summary item for a message or thread.
   *
   * @param {nsIMsgDBHdr[]} messages - An array of messages to summarize.
   * @param {object} [options={}] - Optional object to customize the output:
   * @param {boolean} options.showSubject - true if the subject of the message
   *   should be shown.
   * @param {integer} options.snippetLength - The length in bytes of the message
   *   snippet.
   * @param {boolean} options.belongsToThread - true if we're rendering a
   *   message that belongs to the currently single selected thread.
   * @returns {HTMLLIElement} - The list item node.
   */
  makeSummaryItem(messages, options = {}) {
    const firstMessage = messages[0];
    const isStarred = messages.some(message => message.isFlagged);

    const unreadCount = messages.filter(message => !message.isRead).length;
    const tags = new Set();
    for (const message of messages) {
      for (const tag of this._getTagsForMsg(message)) {
        tags.add(tag);
      }
    }

    const listItem = document
      .getElementById(
        options.belongsToThread ? "threadTemplate" : "multiSelectionTemplate"
      )
      .content.cloneNode(true).firstElementChild;
    listItem.dataset.messageId = firstMessage.messageId;
    listItem.classList.toggle("unread", unreadCount);
    listItem.classList.toggle("starred", isStarred);

    const author = listItem.querySelector(".author");
    author.textContent = DisplayNameUtils.formatDisplayNameList(
      firstMessage.mime2DecodedAuthor,
      "from"
    );

    if (options.showSubject) {
      const subjectNode = listItem.querySelector(".subject");
      subjectNode.textContent =
        firstMessage.mime2DecodedSubject || formatString("noSubject");
      subjectNode.addEventListener("click", () =>
        this._selectCallback(messages)
      );

      if (messages?.length > 1) {
        let numUnreadStr = "";
        if (unreadCount) {
          numUnreadStr = formatString(
            "numUnread",
            [unreadCount.toLocaleString()],
            unreadCount
          );
        }
        const countStr = `(${formatString(
          "numMessages",
          [messages.length.toLocaleString()],
          messages.length
        )}${numUnreadStr})`;

        listItem.querySelector(".count").textContent = countStr;
      }
    } else {
      listItem.querySelector(".date").textContent = makeFriendlyDateAgo(
        new Date(firstMessage.date / 1000)
      );
      author.addEventListener("click", () => {
        this._selectCallback(messages);
      });
    }

    this._addTagNodes(tags, listItem.querySelector(".tags"));

    const snippetNode = listItem.querySelector(".snippet");
    try {
      MsgHdrToMimeMessage(
        firstMessage,
        null,
        function (messageHeader, mimeMessage) {
          if (mimeMessage == null) {
            // Shouldn't happen, but sometimes does?
            return;
          }
          const [text, meta] = mimeMsgToContentSnippetAndMeta(
            mimeMessage,
            messageHeader.folder,
            options.snippetLength
          );
          snippetNode.textContent = text;
          if (meta.author) {
            author.textContent = meta.author;
          }
        },
        false,
        { saneBodySize: true }
      );
    } catch (e) {
      if (e.result == Cr.NS_ERROR_FAILURE) {
        // Offline messages generate exceptions, which is unfortunate.  When
        // that's fixed, this code should adapt. XXX
        snippetNode.textContent = "...";
      } else {
        throw e;
      }
    }
    return listItem;
  }

  /**
   * Show an informative notice about the summarized messages (e.g. if we only
   * summarized some of them).
   *
   * @param {string} aNoticeText The text to show in the notice.
   */
  showNotice(aNoticeText) {
    const notice = document.getElementById("notice");
    notice.textContent = aNoticeText;
  }

  /**
   * Given a msgHdr, return a list of tag objects. This function just does the
   * messy work of understanding how tags are stored in nsIMsgDBHdrs.  It would
   * be a good candidate for a utility library.
   *
   * @param {nsIMsgDBHdr} aMsgHdr - The msgHdr whose tags we want.
   * @returns {nsIMsgTag[]} An array of nsIMsgTag objects.
   */
  _getTagsForMsg(aMsgHdr) {
    const keywords = new Set(aMsgHdr.getStringProperty("keywords").split(" "));
    const allTags = MailServices.tags.getAllTags();

    return allTags.filter(function (tag) {
      return keywords.has(tag.key);
    });
  }

  /**
   * Add a list of tags to a DOM node.
   *
   * @param {nsIMsgTag[]} aTags - An array of nsIMsgTag objects.
   * @param {Node} aTagsNode - The DOM node to contain the list of tags.
   */
  _addTagNodes(aTags, aTagsNode) {
    // Make sure the tags are sorted in their natural order.
    const sortedTags = [...aTags];
    sortedTags.sort(function (a, b) {
      return a.key.localeCompare(b.key) || a.ordinal.localeCompare(b.ordinal);
    });

    for (const tag of sortedTags) {
      const tagNode = document.createElement("span");

      tagNode.className = "tag";
      const color = MailServices.tags.getColorForKey(tag.key);
      if (color) {
        const textColor = !TagUtils.isColorContrastEnough(color)
          ? "white"
          : "black";
        tagNode.setAttribute(
          "style",
          "color: " + textColor + "; background-color: " + color + ";"
        );
      }
      tagNode.dataset.tag = tag.tag;
      tagNode.textContent = tag.tag;
      aTagsNode.appendChild(tagNode);
    }
  }

  /**
   * Compute the size of the messages in the selection and display it in the
   * element of id "size".
   *
   * @param {nsIMsgDBHdr} aMessages - Messages.
   */
  _computeSize(aMessages) {
    let numBytes = 0;
    for (const msgHdr of aMessages) {
      numBytes += msgHdr.messageSize;
      // XXX do something about news?
    }

    const format = aMessages.limited
      ? "messagesTotalSizeMoreThan"
      : "messagesTotalSize";
    document.getElementById("size").textContent = formatString(format, [
      gMessenger.formatFileSize(numBytes),
    ]);
  }

  // These are listeners for the gloda collections.
  onItemsAdded() {}
  onItemsModified(aItems) {
    this._processItems(aItems);
  }
  onItemsRemoved() {}

  /**
   * Given a set of items from a gloda collection, process them and update
   * the display accordingly.
   *
   * @param {GlodaMessage[]} aItems - Contents of a gloda collection.
   */
  _processItems(aItems) {
    const knownMessageNodes = new Map();

    for (const glodaMsg of aItems) {
      // Unread and starred will get set if any of the messages in a collapsed
      // thread qualify.  The trick here is that we may get multiple items
      // corresponding to the same thread (and hence DOM node), so we need to
      // detect when we get the first item for a particular DOM node, stash the
      // preexisting status of that DOM node, an only do transitions if the
      // items warrant it.
      const key = glodaMsg.messageKey + glodaMsg.folder.uri;
      const headerNode = this._msgNodes[key];
      if (!headerNode) {
        continue;
      }
      if (!knownMessageNodes.has(headerNode)) {
        knownMessageNodes.set(headerNode, {
          read: true,
          starred: false,
          tags: new Set(),
        });
      }

      const flags = knownMessageNodes.get(headerNode);

      // Count as read if *all* the messages are read.
      flags.read &= glodaMsg.read;
      // Count as starred if *any* of the messages are starred.
      flags.starred |= glodaMsg.starred;
      // Count as tagged with a tag if *any* of the messages have that tag.
      for (const tag of this._getTagsForMsg(glodaMsg.folderMessage)) {
        flags.tags.add(tag);
      }
    }

    for (const [headerNode, flags] of knownMessageNodes) {
      headerNode.classList.toggle("unread", !flags.read);
      headerNode.classList.toggle("starred", flags.starred);

      // Clear out all the tags and start fresh, just to make sure we don't get
      // out of sync.
      const tagsNode = headerNode.querySelector(".tags");
      tagsNode.replaceChildren();

      this._addTagNodes(flags.tags, tagsNode);
    }
  }

  onQueryCompleted() {
    // If we need something that's just available from GlodaMessages, this is
    // where we'll get it initially.
    if (this._listener) {
      this._listener.onLoadCompleted();
    }
  }
}

/**
 * A summarizer to use for a single thread.
 */
class ThreadSummarizer {
  /**
   * The maximum number of messages to summarize.
   */
  kMaxSummarizedMessages = 100;

  /**
   * The length of message snippets to fetch from Gloda.
   */
  kSnippetLength = 300;

  /**
   * @returns {string} returns a canonical name for this summarizer.
   */
  get name() {
    return "thread";
  }

  /**
   * A function to be called once the summarizer has been registered with the
   * main summary object.
   *
   * @param {MultiMessageSummary} aContext - The MultiMessageSummary object holding this summarizer.
   */
  onregistered(aContext) {
    this.context = aContext;
  }

  /**
   * Summarize a list of messages.
   *
   * @param {nsIMsgDBHdr[]} aMessages - The messages to summarize.
   * @returns {nsIMsgDBHdr[]} an array of the messages actually summarized.
   */
  summarize(aMessages) {
    const messageList = document.getElementById("messageList");

    // Remove all ignored messages from summarization.
    const summarizedMessages = [];
    for (const message of aMessages) {
      if (!message.isKilled) {
        summarizedMessages.push(message);
      }
    }
    const ignoredCount = aMessages.trueLength - summarizedMessages.length;

    // Summarize the selected messages.
    let subject = null;
    let maxCountExceeded = false;
    for (const [i, msgHdr] of summarizedMessages.entries()) {
      if (i == this.kMaxSummarizedMessages) {
        summarizedMessages.length = i;
        maxCountExceeded = true;
        break;
      }

      if (subject == null) {
        subject = msgHdr.mime2DecodedSubject;
      }

      const msgNode = this.context.makeSummaryItem([msgHdr], {
        snippetLength: this.kSnippetLength,
        belongsToThread: true,
      });
      messageList.appendChild(msgNode);

      this.context.mapMsgToNode(msgHdr, msgNode);
    }

    // Set the heading based on the subject and number of messages.
    let countInfo = formatString(
      "numMessages",
      [aMessages.length.toLocaleString()],
      aMessages.length
    );
    if (ignoredCount != 0) {
      const format = aMessages.limited ? "atLeastNumIgnored" : "numIgnored";
      countInfo += formatString(
        format,
        [ignoredCount.toLocaleString()],
        ignoredCount
      );
    }

    this.context.setHeading(subject || formatString("noSubject"), countInfo);

    if (maxCountExceeded) {
      this.context.showNotice(
        formatString("maxCountExceeded", [
          aMessages.trueLength.toLocaleString(),
          this.kMaxSummarizedMessages.toLocaleString(),
        ])
      );
    }
    return summarizedMessages;
  }
}

/**
 * A summarizer to use when multiple threads are selected.
 */
class MultipleSelectionSummarizer {
  /**
   * The maximum number of threads to summarize.
   */
  kMaxSummarizedThreads = 100;

  /**
   * The length of message snippets to fetch from Gloda.
   */
  kSnippetLength = 300;

  /**
   * Returns a canonical name for this summarizer.
   */
  get name() {
    return "multipleselection";
  }

  /**
   * A function to be called once the summarizer has been registered with the
   * main summary object.
   *
   * @param {MultiMessageSummary} aContext - The MultiMessageSummary object
   *   holding this summarizer.
   */
  onregistered(aContext) {
    this.context = aContext;
  }

  /**
   * Summarize a list of messages.
   *
   * @param {nsIMsgDBHdr[]} aMessages - The messages to summarize.
   */
  summarize(aMessages, aDBView) {
    const messageList = document.getElementById("messageList");

    const threads = lazy.isConversationView
      ? Array.from(aMessages, m => [m])
      : this._buildThreads(aMessages, aDBView);
    const threadsCount = threads.length;

    // Set the heading based on the number of messages & threads.
    const format = aMessages.limited
      ? "atLeastNumConversations"
      : "numConversations";
    this.context.setHeading(
      formatString(format, [threads.length.toLocaleString()], threads.length)
    );

    // Summarize the selected messages by thread.
    let maxCountExceeded = false;
    for (const [i, msgs] of threads.entries()) {
      if (i == this.kMaxSummarizedThreads) {
        threads.length = i;
        maxCountExceeded = true;
        break;
      }

      const msgNode = this.context.makeSummaryItem(msgs, {
        showSubject: true,
        snippetLength: this.kSnippetLength,
        belongsToThread: false,
      });
      messageList.appendChild(msgNode);

      for (const msgHdr of msgs) {
        this.context.mapMsgToNode(msgHdr, msgNode);
      }
    }

    if (maxCountExceeded) {
      this.context.showNotice(
        formatString("maxThreadCountExceeded", [
          threadsCount.toLocaleString(),
          this.kMaxSummarizedThreads.toLocaleString(),
        ])
      );

      // Return only the messages for the threads we're actually showing. We
      // need to collapse our array-of-arrays into a flat array.
      return threads.reduce(function (accum, curr) {
        accum.push(...curr);
        return accum;
      }, []);
    }

    // Return everything, since we're showing all the threads. Don't forget to
    // turn it into an array, though!
    return [...aMessages];
  }

  /**
   * Group all the messages to be summarized into threads.
   *
   * @param {nsIMsgDBHdr[]} aMessages The messages to group.
   * @returns {nsIMsgDBHdr[]} An array of arrays of messages, grouped by thread.
   */
  _buildThreads(aMessages, aDBView) {
    // First, we group the messages in threads and count the threads.
    const threads = [];
    const threadMap = {};
    for (const msgHdr of aMessages) {
      const viewThreadId = aDBView.getThreadContainingMsgHdr(msgHdr).threadKey;
      if (!(viewThreadId in threadMap)) {
        threadMap[viewThreadId] = threads.length;
        threads.push([msgHdr]);
      } else {
        threads[threadMap[viewThreadId]].push(msgHdr);
      }
    }
    return threads;
  }
}

var gMessageSummary = new MultiMessageSummary();
gMessageSummary.registerSummarizer(new ThreadSummarizer());
gMessageSummary.registerSummarizer(new MultipleSelectionSummarizer());

/**
 * Roving tab navigation for the header buttons.
 */
const headerToolbarNavigation = {
  /**
   * If the roving tab has already been loaded.
   *
   * @type {boolean}
   */
  isLoaded: false,
  /**
   * Get all currently clickable buttons of the message header toolbar.
   *
   * @returns {Array} An array of buttons.
   */
  get headerButtons() {
    return this.headerToolbar.querySelectorAll(
      `toolbarbutton:not([hidden="true"],[disabled="true"])`
    );
  },

  init() {
    // Bail out if we already initialized this.
    if (this.isLoaded) {
      return;
    }
    this.headerToolbar = document.getElementById("header-view-toolbar");
    this.headerToolbar.addEventListener("keypress", event => {
      this.triggerMessageHeaderRovingTab(event);
    });
    this.isLoaded = true;
  },

  /**
   * Update the `tabindex` attribute of the currently clickable buttons.
   */
  updateRovingTab() {
    for (const button of this.headerButtons) {
      button.tabIndex = -1;
    }
    // Allow focus on the first available button.
    // We use `setAttribute` to guarantee compatibility with XUL toolbarbuttons.
    this.headerButtons[0].setAttribute("tabindex", "0");
  },

  /**
   * Handles the keypress event on the message header toolbar.
   *
   * @param {Event} event - The keypress DOMEvent.
   */
  triggerMessageHeaderRovingTab(event) {
    // Expected keyboard actions are Left, Right, Home, End, Space, and Enter.
    if (!["ArrowRight", "ArrowLeft", " ", "Enter"].includes(event.key)) {
      return;
    }

    const headerButtons = [...this.headerButtons];
    const focusableButton = headerButtons.find(b => b.tabIndex != -1);
    let elementIndex = headerButtons.indexOf(focusableButton);

    // TODO: Remove once the buttons are updated to not be XUL
    // NOTE: Normally a button click handler would cover Enter and Space key
    // events. However, we need to prevent the default behavior and explicitly
    // trigger the button click because the XUL toolbarbuttons do not work when
    // the Enter key is pressed. They do work when the Space key is pressed.
    // However, if the toolbarbutton is a dropdown menu, the Space key
    // does not open the menu.
    if (
      event.key == "Enter" ||
      (event.key == " " && event.target.hasAttribute("type"))
    ) {
      event.preventDefault();
      event.target.click();
      return;
    }

    // Find the adjacent focusable element based on the pressed key.
    const isRTL = document.dir == "rtl";
    if (
      (isRTL && event.key == "ArrowLeft") ||
      (!isRTL && event.key == "ArrowRight")
    ) {
      elementIndex++;
      if (elementIndex > headerButtons.length - 1) {
        elementIndex = 0;
      }
    } else if (
      (!isRTL && event.key == "ArrowLeft") ||
      (isRTL && event.key == "ArrowRight")
    ) {
      elementIndex--;
      if (elementIndex == -1) {
        elementIndex = headerButtons.length - 1;
      }
    }

    // Move the focus to a new toolbar button and update the tabindex attribute.
    const newFocusableButton = headerButtons[elementIndex];
    if (newFocusableButton) {
      focusableButton.tabIndex = -1;
      newFocusableButton.setAttribute("tabindex", "0");
      newFocusableButton.focus();
    }
  },
};
