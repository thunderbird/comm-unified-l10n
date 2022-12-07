/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals cal openLinkExternally */

"use strict";

// Wrap in a block to prevent leaking to window scope.
{
  var { recurrenceRule2String } = ChromeUtils.import(
    "resource:///modules/calendar/calRecurrenceUtils.jsm"
  );

  let l10n = new DOMLocalization(["calendar/calendar-invitation-panel.ftl"]);

  /**
   * Base element providing boilerplate for shadow root initialisation.
   */
  class BaseInvitationElement extends HTMLElement {
    /**
     * A previous copy of the event item if found on an existing calendar.
     * @type {calIEvent?}
     */
    foundItem;

    /**
     * The id of the <template> tag to initialize the element with.
     * @param {string?} id
     */
    constructor(id) {
      super();
      this.attachShadow({ mode: "open" });
      l10n.connectRoot(this.shadowRoot);

      let link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "chrome://calendar/skin/shared/widgets/calendar-invitation-panel.css";
      this.shadowRoot.appendChild(link);

      if (id) {
        this.shadowRoot.appendChild(document.getElementById(id).content.cloneNode(true));
      }
    }

    disconnectedCallback() {
      l10n.disconnectRoot(this.shadowRoot);
    }
  }

  /**
   * InvitationPanel displays the details of an iTIP event invitation in an
   * interactive panel.
   */
  class InvitationPanel extends BaseInvitationElement {
    MODE_NEW = "New";
    MODE_ALREADY_PROCESSED = "Processed";
    MODE_UPDATE_MAJOR = "UpdateMajor";
    MODE_UPDATE_MINOR = "UpdateMinor";
    MODE_CANCELLED = "Cancelled";
    MODE_CANCELLED_NOT_FOUND = "CancelledNotFound";

    /**
     * mode determines how the UI should display the received invitation. It
     * must be set to one of the MODE_* constants, defaults to MODE_NEW.
     * @type {string}
     */
    mode = this.MODE_NEW;

    /**
     * The event item to be displayed.
     * @type {calIEvent?}
     */
    item;

    connectedCallback() {
      if (this.item && this.mode) {
        let template = document.getElementById(`calendarInvitationPanel${this.mode}`);
        this.shadowRoot.appendChild(template.content.cloneNode(true));

        let header = this.shadowRoot.querySelector("calendar-invitation-panel-header");
        header.foundItem = this.foundItem;
        header.item = this.item;

        let wrapper = this.shadowRoot.querySelector("calendar-invitation-panel-wrapper");
        wrapper.foundItem = this.foundItem;
        wrapper.item = this.item;
      }
    }
  }
  customElements.define("calendar-invitation-panel", InvitationPanel);

  /**
   * InvitationPanelWrapper wraps the contents of the panel for formatting and
   * provides the minidate to the left of the details.
   */
  class InvitationPanelWrapper extends BaseInvitationElement {
    constructor() {
      super("calendarInvitationPanelWrapper");
    }

    set item(value) {
      this.shadowRoot.querySelector("calendar-minidate").date = value.startDate;
      let props = this.shadowRoot.querySelector("calendar-invitation-panel-properties");
      props.foundItem = this.foundItem;
      props.item = value;
    }
  }
  customElements.define("calendar-invitation-panel-wrapper", InvitationPanelWrapper);

  /**
   * InvitationPanelHeader renders the header part of the invitation panel.
   */
  class InvitationPanelHeader extends BaseInvitationElement {
    constructor() {
      super("calendarInvitationPanelHeader");
    }

    /**
     * Setting the item will populate the header with information.
     * @type {calIEvent}
     */
    set item(item) {
      let l10nArgs = JSON.stringify({
        summary: item.getProperty("SUMMARY") || "",
        organizer: item.organizer ? item.organizer?.commonName || item.organizer.toString() : "",
      });

      let action = this.getAttribute("actionType");
      if (action) {
        this.shadowRoot
          .getElementById("intro")
          .setAttribute("data-l10n-id", `calendar-invitation-panel-intro-${action}`);
      }

      for (let id of ["intro", "title"]) {
        this.shadowRoot.getElementById(id).setAttribute("data-l10n-args", l10nArgs);
      }

      if (this.foundItem && this.foundItem.title != item.title) {
        this.shadowRoot.querySelector("calendar-invitation-change-indicator").hidden = false;
      }
    }

    /**
     * Provides the value of the title displayed as a string.
     * @type {string}
     */
    get fullTitle() {
      return [
        ...this.shadowRoot.querySelectorAll(
          ".calendar-invitation-panel-intro, .calendar-invitation-panel-title"
        ),
      ]
        .map(node => node.textContent)
        .join(" ");
    }
  }
  customElements.define("calendar-invitation-panel-header", InvitationPanelHeader);

  const PROPERTY_REMOVED = -1;
  const PROPERTY_UNCHANGED = 0;
  const PROPERTY_ADDED = 1;
  const PROPERTY_MODIFIED = 2;

  /**
   * InvitationPanelProperties renders the details of the most useful properties
   * of an invitation.
   */
  class InvitationPanelProperties extends BaseInvitationElement {
    constructor() {
      super("calendarInvitationPanelProperties");
    }

    /**
     * Used to retrieve a property value from an event.
     * @callback GetValue
     * @param {calIEvent} event
     * @returns {string}
     */

    /**
     * A function used to make a property value visible in to the user.
     * @callback PropertyShow
     * @param {HTMLElement} node  - The element responsible for displaying the
     *                              value.
     * @param {string} value      - The value of property to display.
     * @param {string} oldValue   - The previous value of the property if the
     *                              there is a prior copy of the event.
     * @param {calIEvent} item    - The event item the property belongs to.
     * @param {string} oldItem    - The prior version of the event if there is
     *                              one.
     */

    /**
     * @typedef {Object} InvitationPropertyDescriptor
     * @property {string} id         - The id of the HTMLElement that displays
     *                                 the property.
     * @property {GetValue} getValue - Function used to retrieve the displayed
     *                                 value of the property from the item.
     * @property {PropertyShow} show - Function to use to display the property
     *                                 value.
     */

    /**
     * A static list of objects used in determining how to display each of the
     * properties.
     * @type {PropertyDescriptor[]}
     */
    static propertyDescriptors = [
      {
        id: "interval",
        getValue(item) {
          let tz = cal.dtz.defaultTimezone;
          let startDate = item.startDate?.getInTimezone(tz) ?? null;
          let endDate = item.endDate?.getInTimezone(tz) ?? null;
          return `${startDate.icalString}-${endDate?.icalString}`;
        },
        show(intervalNode, newValue, oldValue, item) {
          intervalNode.item = item;
        },
      },
      {
        id: "recurrence",
        getValue(item) {
          let parent = item.parentItem;
          if (!parent.recurrenceInfo) {
            return null;
          }
          return recurrenceRule2String(parent.recurrenceInfo, parent.recurrenceStartDate);
        },
        show(recurrence, value) {
          recurrence.appendChild(document.createTextNode(value));
        },
      },
      {
        id: "location",
        getValue(item) {
          return item.getProperty("LOCATION");
        },
        show(location, value) {
          location.appendChild(cal.view.textToHtmlDocumentFragment(value, document));
        },
      },
      {
        id: "description",
        getValue(item) {
          return item.descriptionText;
        },
        show(description, value) {
          description.appendChild(cal.view.textToHtmlDocumentFragment(value, document));
        },
      },
    ];

    /**
     * Setting the item will populate the table that displays the event
     * properties.
     * @type {calIEvent}
     */
    set item(item) {
      for (let prop of InvitationPanelProperties.propertyDescriptors) {
        let el = this.shadowRoot.getElementById(prop.id);
        let value = prop.getValue(item);
        let oldValue;
        let result = PROPERTY_UNCHANGED;
        if (this.foundItem) {
          oldValue = prop.getValue(this.foundItem);
          result = this.compare(oldValue, value);
          if (result) {
            let indicator = this.shadowRoot.getElementById(`${prop.id}ChangeIndicator`);
            if (indicator) {
              indicator.type = result;
              indicator.hidden = false;
            }
          }
        }
        if (value) {
          prop.show(el, value, oldValue, item, this.foundItem, result);
        }
      }

      let attendeeValues = item.getAttendees();
      this.shadowRoot.getElementById("summary").attendees = attendeeValues;

      let attendees = this.shadowRoot.getElementById("attendees");
      if (this.foundItem) {
        attendees.oldValue = this.foundItem.getAttendees();
      }
      attendees.value = attendeeValues;

      let attachments = this.shadowRoot.getElementById("attachments");
      if (this.foundItem) {
        attachments.oldValue = this.foundItem.getAttachments();
      }
      attachments.value = item.getAttachments();
    }

    /**
     * Compares two like property values, an old and a new one, to determine
     * what type of change has been made (if any).
     *
     * @param {any} oldValue
     * @param {any} newValue
     * @returns {number} - One of the PROPERTY_* constants.
     */
    compare(oldValue, newValue) {
      if (!oldValue && newValue) {
        return PROPERTY_ADDED;
      }
      if (oldValue && !newValue) {
        return PROPERTY_REMOVED;
      }
      return oldValue != newValue ? PROPERTY_MODIFIED : PROPERTY_UNCHANGED;
    }
  }
  customElements.define("calendar-invitation-panel-properties", InvitationPanelProperties);

  /**
   * InvitationInterval displays the formatted interval of the event. Formatting
   * relies on cal.dtz.formatter.formatIntervalParts().
   */
  class InvitationInterval extends BaseInvitationElement {
    constructor() {
      super("calendarInvitationInterval");
    }

    /**
     * The item whose interval to show.
     * @type {calIEvent}
     */
    set item(value) {
      let [startDate, endDate] = cal.dtz.formatter.getItemDates(value);
      let timezone = startDate.timezone.displayName;
      let parts = cal.dtz.formatter.formatIntervalParts(startDate, endDate);
      l10n.setAttributes(
        this.shadowRoot.getElementById("interval"),
        `calendar-invitation-interval-${parts.type}`,
        { ...parts, timezone }
      );
    }
  }
  customElements.define("calendar-invitation-interval", InvitationInterval);

  const partStatOrder = ["ACCEPTED", "DECLINED", "TENTATIVE", "NEEDS-ACTION"];

  /**
   * InvitationPartStatSummary generates text indicating the aggregated
   * participation status of each attendee in the event's attendees list.
   */
  class InvitationPartStatSummary extends BaseInvitationElement {
    constructor() {
      super("calendarInvitationPartStatSummary");
    }

    /**
     * Setting this property will trigger an update of the text displayed.
     * @type {calIAttendee[]}
     */
    set attendees(attendees) {
      let counts = {
        ACCEPTED: 0,
        DECLINED: 0,
        TENTATIVE: 0,
        "NEEDS-ACTION": 0,
        TOTAL: attendees.length,
        OTHER: 0,
      };

      for (let { participationStatus } of attendees) {
        if (counts.hasOwnProperty(participationStatus)) {
          counts[participationStatus]++;
        } else {
          counts.OTHER++;
        }
      }
      l10n.setAttributes(
        this.shadowRoot.getElementById("total"),
        "calendar-invitation-panel-partstat-total",
        { count: counts.TOTAL }
      );

      let shownPartStats = partStatOrder.filter(partStat => counts[partStat]);
      let breakdown = this.shadowRoot.getElementById("breakdown");
      for (let partStat of shownPartStats) {
        let span = document.createElement("span");
        span.setAttribute("class", "calendar-invitation-panel-partstat-summary");

        // calendar-invitation-panel-partstat-accepted
        // calendar-invitation-panel-partstat-declined
        // calendar-invitation-panel-partstat-tentative
        // calendar-invitation-panel-partstat-needs-action
        l10n.setAttributes(span, `calendar-invitation-panel-partstat-${partStat.toLowerCase()}`, {
          count: counts[partStat],
        });
        breakdown.appendChild(span);
      }
    }
  }
  customElements.define("calendar-invitation-partstat-summary", InvitationPartStatSummary);

  /**
   * BaseInvitationChangeList is a <ul> element that can visually show changes
   * between elements of a list value.
   * @template T
   */
  class BaseInvitationChangeList extends HTMLUListElement {
    /**
     * An array containing the old values to be compared against for changes.
     * @type {T[]}
     */
    oldValue = [];

    /**
     * String indicating the type of list items to create. This is passed
     * directly to the "is" argument of document.createElement().
     * @abstract
     */
    listItem;

    _createListItem(value, status) {
      let li = document.createElement("li", { is: this.listItem });
      li.changeStatus = status;
      li.value = value;
      return li;
    }

    /**
     * Setting this property will trigger rendering of the list. If no prior
     * values are detected, change indicators are not touched.
     * @type {T[]}
     */
    set value(list) {
      if (!this.oldValue.length) {
        for (let value of list) {
          this.append(this._createListItem(value));
        }
        return;
      }
      for (let [value, status] of this.getChanges(this.oldValue, list)) {
        this.appendChild(this._createListItem(value, status));
      }
    }

    /**
     * Implemented by sub-classes to generate a list of changes for each element
     * of the new list.
     *
     * @param {T[]} oldValue
     * @param {T[]} newValue
     *
     * @return {[T, number][]}
     */
    getChanges(oldValue, newValue) {
      throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
    }
  }

  /**
   * BaseInvitationChangeListItem is the <li> element used for change lists.
   * @template {T}
   */
  class BaseInvitationChangeListItem extends HTMLLIElement {
    /**
     * Indicates whether the item value has changed and should be displayed as
     * such. Its value is one of the PROPERTY_* constants.
     * @type {number}
     */
    changeStatus = PROPERTY_UNCHANGED;

    /**
     * Settings this property will render the list item including a change
     * indicator if the changeStatus property != PROPERTY_UNCHANGED.
     * @type {T}
     */
    set value(itemValue) {
      this.build(itemValue);
      if (this.changeStatus) {
        let changeIndicator = document.createElement("calendar-invitation-change-indicator");
        changeIndicator.type = this.changeStatus;
        this.append(changeIndicator);
      }
    }

    /**
     * Implemented by sub-classes to build the <li> inner DOM structure.
     * @param {T} value
     * @abstract
     */
    build(value) {
      throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
    }
  }

  /**
   * InvitationAttendeeList displays a list of all the attendees on an event's
   * attendee list.
   */
  class InvitationAttendeeList extends BaseInvitationChangeList {
    listItem = "calendar-invitation-panel-attendee-list-item";

    getChanges(oldValue, newValue) {
      let diff = [];
      for (let att of newValue) {
        let oldAtt = oldValue.find(oldAtt => oldAtt.id == att.id);
        if (!oldAtt) {
          diff.push([att, PROPERTY_ADDED]); // New attendee.
        } else if (oldAtt.participationStatus != att.participationStatus) {
          diff.push([att, PROPERTY_MODIFIED]); // Participation status changed.
        } else {
          diff.push([att, PROPERTY_UNCHANGED]); // No change.
        }
      }

      // Insert removed attendees into the diff.
      for (let [idx, att] of oldValue.entries()) {
        let found = newValue.find(newAtt => newAtt.id == att.id);
        if (!found) {
          diff.splice(idx, 0, [att, PROPERTY_REMOVED]);
        }
      }
      return diff;
    }
  }
  customElements.define("calendar-invitation-panel-attendee-list", InvitationAttendeeList, {
    extends: "ul",
  });

  /**
   * InvitationAttendeeListItem displays a single attendee from the attendee
   * list.
   */
  class InvitationAttendeeListItem extends BaseInvitationChangeListItem {
    build(value) {
      let span = document.createElement("span");
      if (this.changeStatus == PROPERTY_REMOVED) {
        span.setAttribute("class", "removed");
      }
      span.textContent = value;
      this.appendChild(span);
    }
  }
  customElements.define(
    "calendar-invitation-panel-attendee-list-item",
    InvitationAttendeeListItem,
    {
      extends: "li",
    }
  );

  /**
   * InvitationAttachmentList displays a list of all attachments in the invitation
   * that have URIs. Binary attachments are not supported.
   */
  class InvitationAttachmentList extends BaseInvitationChangeList {
    listItem = "calendar-invitation-panel-attachment-list-item";

    getChanges(oldValue, newValue) {
      let diff = [];
      for (let attch of newValue) {
        if (!attch.uri) {
          continue;
        }
        let oldAttch = oldValue.find(
          oldAttch => oldAttch.uri && oldAttch.uri.spec == attch.uri.spec
        );

        if (!oldAttch) {
          // New attachment.
          diff.push([attch, PROPERTY_ADDED]);
          continue;
        }
        if (
          attch.hashId != oldAttch.hashId ||
          attch.getParameter("FILENAME") != oldAttch.getParameter("FILENAME")
        ) {
          // Contents changed or renamed.
          diff.push([attch, PROPERTY_MODIFIED]);
          continue;
        }
        // No change.
        diff.push([attch, PROPERTY_UNCHANGED]);
      }

      // Insert removed attachments into the diff.
      for (let [idx, attch] of oldValue.entries()) {
        if (!attch.uri) {
          continue;
        }
        let found = newValue.find(newAtt => newAtt.uri && newAtt.uri.spec == attch.uri.spec);
        if (!found) {
          diff.splice(idx, 0, [attch, PROPERTY_REMOVED]);
        }
      }
      return diff;
    }
  }
  customElements.define("calendar-invitation-panel-attachment-list", InvitationAttachmentList, {
    extends: "ul",
  });

  /**
   * InvitationAttachmentListItem displays a link to an attachment attached to the
   * event.
   */
  class InvitationAttachmentListItem extends BaseInvitationChangeListItem {
    /**
     * Indicates whether the attachment has changed and should be displayed as
     * such. Its value is one of the PROPERTY_* constants.
     * @type {number}
     */
    changeStatus = PROPERTY_UNCHANGED;

    /**
     * Sets up the attachment to be displayed as a link with appropriate icon.
     * Links are opened externally.
     * @param {calIAttachment}
     */
    build(value) {
      let icon = document.createElement("img");
      let iconSrc = value.uri.spec.length ? value.uri.spec : "dummy.html";
      if (!value.uri.schemeIs("file")) {
        // Using an uri directly, with e.g. a http scheme, wouldn't render any icon.
        if (value.formatType) {
          iconSrc = "goat?contentType=" + value.formatType;
        } else {
          // Let's try to auto-detect.
          let parts = iconSrc.substr(value.uri.scheme.length + 2).split("/");
          if (parts.length) {
            iconSrc = parts[parts.length - 1];
          }
        }
      }
      icon.setAttribute("src", "moz-icon://" + iconSrc);
      this.append(icon);

      let title = value.getParameter("FILENAME") || value.uri.spec;
      if (this.changeStatus == PROPERTY_REMOVED) {
        let span = document.createElement("span");
        span.setAttribute("class", "removed");
        span.textContent = title;
        this.append(span);
      } else {
        let link = document.createElement("a");
        link.textContent = title;
        link.setAttribute("href", value.uri.spec);
        link.addEventListener("click", event => {
          event.preventDefault();
          openLinkExternally(event.target.href);
        });
        this.append(link);
      }
    }
  }
  customElements.define(
    "calendar-invitation-panel-attachment-list-item",
    InvitationAttachmentListItem,
    {
      extends: "li",
    }
  );

  /**
   * InvitationChangeIndicator is a visual indicator for indicating some piece
   * of data has changed.
   */
  class InvitationChangeIndicator extends HTMLElement {
    _typeMap = {
      [PROPERTY_REMOVED]: "removed",
      [PROPERTY_ADDED]: "added",
      [PROPERTY_MODIFIED]: "modified",
    };

    /**
     * One of the PROPERTY_* constants that indicates what kind of change we
     * are indicating (add/modify/delete) etc.
     * @type {number}
     */
    type = PROPERTY_MODIFIED;

    connectedCallback() {
      let key = this._typeMap[this.type];
      this.setAttribute("data-l10n-id", `calendar-invitation-change-indicator-${key}`);
    }
  }
  customElements.define("calendar-invitation-change-indicator", InvitationChangeIndicator);

  /**
   * InvitationPanelFooter renders the footer for the details section of
   * the invitation panel.
   */
  class InvitationPanelFooter extends BaseInvitationElement {
    constructor() {
      super("calendarInvitationPanelFooter");
    }

    connectedCallback() {
      l10n.setAttributes(
        this.shadowRoot.getElementById("status"),
        "calendar-invitation-panel-reply-status"
      );
    }
  }
  customElements.define("calendar-invitation-panel-footer", InvitationPanelFooter);
}
