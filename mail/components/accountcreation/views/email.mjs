/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {
  AccountCreationUtils: {
    gAccountSetupLogger,
    SuccessiveAbortable,
    UserCancelledException,
    AddonInstaller,
  },
} = ChromeUtils.importESModule(
  "resource:///modules/accountcreation/AccountCreationUtils.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AccountConfig: "resource:///modules/accountcreation/AccountConfig.sys.mjs",
  cal: "resource:///modules/calendar/calUtils.sys.mjs",
  CardDAVUtils: "resource:///modules/CardDAVUtils.sys.mjs",
  CreateInBackend:
    "resource:///modules/accountcreation/CreateInBackend.sys.mjs",
  ConfigVerifier: "resource:///modules/accountcreation/ConfigVerifier.sys.mjs",
  FindConfig: "resource:///modules/accountcreation/FindConfig.sys.mjs",
  GuessConfig: "resource:///modules/accountcreation/GuessConfig.sys.mjs",
  MailServices: "resource:///modules/MailServices.sys.mjs",
  OAuth2Module: "resource:///modules/OAuth2Module.sys.mjs",
  Sanitizer: "resource:///modules/accountcreation/Sanitizer.sys.mjs",
  getAddonsList:
    "resource:///modules/accountcreation/ExchangeAutoDiscover.sys.mjs",
});

ChromeUtils.defineLazyGetter(
  lazy,
  "l10n",
  () => new Localization(["messenger/accountcreation/accountSetup.ftl"], true)
);

import "chrome://messenger/content/accountcreation/content/widgets/account-hub-step.mjs"; // eslint-disable-line import/no-unassigned-import
import "chrome://messenger/content/accountcreation/content/widgets/account-hub-footer.mjs"; // eslint-disable-line import/no-unassigned-import

class AccountHubEmail extends HTMLElement {
  /**
   * Email config footer.
   *
   * @type {HTMLElement}
   */
  #emailFooter;

  /**
   * Email auto config subview.
   *
   * @type {HTMLElement}
   */
  #emailAutoConfigSubview;

  /**
   * Email incoming config subview.
   *
   * @type {HTMLElement}
   */
  #emailIncomingConfigSubview;

  /**
   * Email incoming config subview.
   *
   * @type {HTMLElement}
   */
  #emailOutgoingConfigSubview;

  /**
   * Email config found subview.
   *
   * @type {HTMLElement}
   */
  #emailConfigFoundSubview;

  /**
   * Email add password subview.
   *
   * @type {HTMLElement}
   */
  #emailPasswordSubview;

  /**
   * Email sync accounts subview.
   *
   * @type {HTMLElement}
   */
  #emailSyncAccountsSubview;

  /**
   * Email added success subview.
   *
   * @type {HTMLElement}
   */
  #emailAddedSuccessSubview;

  // TODO: Clean up excess global variables and use IDs in state instead.

  /**
   * Store methods to interrupt abortable operations like testing
   * a server configuration or installing an add-on.
   * Name is overridden to avoid conflict in JSDoc generation.
   *
   * @name AccountHub~abortable
   * @type {Abortable}
   */
  #abortable;

  /**
   * The current Account Config object based on the users form inputs.
   *
   * @type {AccountConfig}
   */
  #currentConfig;

  /**
   * A Config Verifier object that verfies the currentConfig.
   *
   * @type {ConfigVerifier}
   */
  #configVerifier;

  /**
   * String of ID of current step in email flow.
   *
   * @type {string}
   */
  #currentState;

  /**
   * The email for the current user.
   *
   * @type {string}
   */
  #email;

  /**
   * The real name for the current user.
   *
   * @type {string}
   */
  #realName;

  /**
   * States of the email setup flow, based on the ID's of the steps in the
   * flow.
   *
   * @type {object}
   */
  #states = {
    autoConfigSubview: {
      id: "emailAutoConfigSubview",
      nextStep: "emailConfigFoundSubview",
      previousStep: "",
      forwardEnabled: false,
      customActionFluentID: "",
      customBackFluentID: "account-hub-email-cancel-button",
      subview: {},
      templateId: "email-auto-form",
    },
    emailConfigFoundSubview: {
      id: "emailConfigFoundSubview",
      nextStep: "emailPasswordSubview",
      previousStep: "autoConfigSubview",
      forwardEnabled: true,
      customActionFluentID: "",
      subview: {},
      templateId: "email-config-found",
    },
    emailPasswordSubview: {
      id: "emailPasswordSubview",
      nextStep: "emailSyncAccountsSubview",
      previousStep: "emailConfigFoundSubview",
      forwardEnabled: false,
      customActionFluentID: "",
      subview: {},
      templateId: "email-password-form",
    },
    emailSyncAccountsSubview: {
      id: "emailSyncAccountsSubview",
      nextStep: "emailAddedSuccessSubview",
      previousStep: "",
      forwardEnabled: true,
      customActionFluentID: "",
      subview: {},
      templateId: "email-sync-accounts-form",
    },
    incomingConfigSubview: {
      id: "emailIncomingConfigSubview",
      nextStep: "outgoingConfigSubview",
      previousStep: "emailConfigFoundSubview",
      forwardEnabled: true,
      customActionFluentID: "",
      subview: {},
      templateId: "email-manual-incoming-form",
    },
    outgoingConfigSubview: {
      id: "emailOutgoingConfigSubview",
      nextStep: "emailPasswordSubview",
      previousStep: "incomingConfigSubview",
      forwardEnabled: true,
      customActionFluentID: "account-hub-test-configuration",
      subview: {},
      templateId: "email-manual-outgoing-form",
    },
    emailAddedSuccessSubview: {
      id: "emailAddedSuccessSubview",
      nextStep: true,
      previousStep: "",
      forwardEnabled: true,
      customForwardFluentID: "account-hub-email-finish-button",
      customActionFluentID: "account-hub-add-new-email",
      subview: {},
      templateId: "email-added-success",
    },
  };

  async connectedCallback() {
    if (this.hasConnected) {
      return;
    }
    this.hasConnected = true;

    this.classList.add("account-hub-view");

    const template = document.getElementById("accountHubEmailSetup");
    this.appendChild(template.content.cloneNode(true));

    this.#emailAutoConfigSubview = this.querySelector(
      "#emailAutoConfigSubview"
    );
    this.#states.autoConfigSubview.subview = this.#emailAutoConfigSubview;
    this.#emailIncomingConfigSubview = this.querySelector(
      "#emailIncomingConfigSubview"
    );
    this.#states.incomingConfigSubview.subview =
      this.#emailIncomingConfigSubview;
    this.#emailOutgoingConfigSubview = this.querySelector(
      "#emailOutgoingConfigSubview"
    );
    this.#states.outgoingConfigSubview.subview =
      this.#emailOutgoingConfigSubview;

    this.#emailConfigFoundSubview = this.querySelector(
      "#emailConfigFoundSubview"
    );
    this.#states.emailConfigFoundSubview.subview =
      this.#emailConfigFoundSubview;
    this.#emailPasswordSubview = this.querySelector("#emailPasswordSubview");
    this.#states.emailPasswordSubview.subview = this.#emailPasswordSubview;
    this.#emailSyncAccountsSubview = this.querySelector(
      "#emailSyncAccountsSubview"
    );
    this.#states.emailSyncAccountsSubview.subview =
      this.#emailSyncAccountsSubview;

    this.#emailAddedSuccessSubview = this.querySelector(
      "#emailAddedSuccessSubview"
    );
    this.#states.emailAddedSuccessSubview.subview =
      this.#emailAddedSuccessSubview;

    this.#emailFooter = this.querySelector("account-hub-footer");
    this.#emailFooter.addEventListener("back", this);
    this.#emailFooter.addEventListener("forward", this);
    this.#emailFooter.addEventListener("custom-footer-action", this);
    this.#emailAutoConfigSubview.addEventListener("config-updated", this);
    this.#emailIncomingConfigSubview.addEventListener("config-updated", this);
    this.#emailOutgoingConfigSubview.addEventListener("config-updated", this);
    this.#emailPasswordSubview.addEventListener("config-updated", this);
    this.#emailConfigFoundSubview.addEventListener("edit-configuration", this);
    this.#emailConfigFoundSubview.addEventListener("config-updated", this);
    this.#emailConfigFoundSubview.addEventListener("install-addon", this);
    this.#emailIncomingConfigSubview.addEventListener("advanced-config", this);
    this.#emailOutgoingConfigSubview.addEventListener("advanced-config", this);

    this.#abortable = null;
    this.#currentConfig = {};
    this.#email = "";
    this.#realName = "";

    this.addEventListener("submit", this);

    this.ready = this.#initUI("autoConfigSubview");
    await this.ready;
    this.#emailAutoConfigSubview.setState();
  }

  /**
   * Returns the subview of the current state.
   *
   * @returns {HTMLElement} The current subview.
   */
  get #currentSubview() {
    return this.#states[this.#currentState].subview;
  }

  /**
   * Handle for async operation that's cancellable.
   * Setting the abortable property updates the hidden state of the cancel
   * button and the disabled state of the forward button.
   *
   * @type {?Abortable}
   */
  set abortable(abortablePromise) {
    const stateDetails = this.#states[this.#currentState];
    this.#emailFooter.canBack(abortablePromise || stateDetails.previousStep);
    // TODO: Update button to say cancel when setDirectionalButtonText is
    // available.
    this.#emailFooter.toggleForwardDisabled(
      !!abortablePromise || stateDetails.canForward
    );
    this.#abortable = abortablePromise;
  }

  get abortable() {
    return this.#abortable;
  }

  /**
   * Initialize the UI of one of the email setup subviews.
   *
   * @param {string} subview - Subview for which the UI is being inititialized.
   */
  async #initUI(subview) {
    this.#hideSubviews();
    this.#clearNotifications();
    this.#currentState = subview;
    await this.#loadTemplateScript(this.#states[subview].templateId);
    this.#currentSubview.hidden = false;
    this.#setFooterButtons();
  }

  /**
   * Initialize the UI of one of the email setup subviews.
   *
   * @param {string} templateId - ID of the template that needs to be loaded.
   */
  async #loadTemplateScript(templateId) {
    if (customElements.get(templateId)) {
      return Promise.resolve();
    }

    // eslint-disable-next-line no-unsanitized/method
    return import(
      `chrome://messenger/content/accountcreation/content/widgets/${templateId}.mjs`
    );
  }

  /**
   * Hide all of the subviews in the account hub email flow to show
   * whichever subview needs to be shown.
   */
  #hideSubviews() {
    this.#emailConfigFoundSubview.hidden = true;
    this.#emailSyncAccountsSubview.hidden = true;
    this.#emailPasswordSubview.hidden = true;
    this.#emailAddedSuccessSubview.hidden = true;
    this.#emailAutoConfigSubview.hidden = true;
    this.#emailIncomingConfigSubview.hidden = true;
    this.#emailOutgoingConfigSubview.hidden = true;
  }

  /**
   * Calls the clear notification method in the current step.
   */
  #clearNotifications() {
    if (this.#currentState) {
      this.#currentSubview.clearNotifications?.();
    }
  }

  /**
   * Sets the footer buttons in the footer template
   */
  #setFooterButtons() {
    const stateDetails = this.#states[this.#currentState];
    this.#emailFooter.canBack(stateDetails.previousStep);
    this.#emailFooter.canForward(stateDetails.nextStep);
    this.#emailFooter.canCustom(stateDetails.customActionFluentID);
    this.#emailFooter.setDirectionalButtonText(
      "forward",
      stateDetails.customForwardFluentID
    );
    this.#emailFooter.setDirectionalButtonText(
      "back",
      stateDetails.customBackFluentID
    );

    // The footer forward button is disabled by default.
    this.#emailFooter.toggleForwardDisabled(!stateDetails.forwardEnabled);
  }

  #loadingTimeout = null;

  /**
   * Show a loading notification and disable all inputs (except closing the
   * dialog). If the load takes too long, a spinner is overlaid.
   *
   * TODO: should be able to cancel some loads, if they're abortable.
   *
   * @param {string} loadingFluentId
   */
  #startLoading(loadingFluentId) {
    this.#states[this.#currentState].subview.showNotification({
      fluentTitleId: loadingFluentId,
      type: "info",
    });
    this.classList.add("busy");
    this.#states[this.#currentState].subview.disabled = true;
    this.#emailFooter.disabled = true;
    this.#loadingTimeout = setTimeout(() => {
      this.classList.add("spinner");
      this.#loadingTimeout = null;
    }, 3000);
  }

  /**
   * Stop loading, clearing the notification, restoring form controls and hiding
   * the spinner if it was visible.
   */
  #stopLoading() {
    this.#clearNotifications();
    this.#states[this.#currentState].subview.disabled = false;
    this.#emailFooter.disabled = false;
    this.classList.remove("busy", "spinner");
    if (this.#loadingTimeout) {
      clearTimeout(this.#loadingTimeout);
      this.#loadingTimeout = null;
    }
  }

  /**
   * Handle the events from the subviews.
   *
   * @param {Event} event
   */
  async handleEvent(event) {
    const stateDetails = this.#states[this.#currentState];
    switch (event.type) {
      case "back":
        try {
          if (!this.abortable) {
            await this.#initUI(stateDetails.previousStep);
            this.#handleBackAction(this.#currentState);
          } else {
            this.#handleAbortable();
          }
        } catch (error) {
          this.#currentSubview.showNotification({
            title: error.cause.code,
            description: error.cause.text,
            error,
            type: "error",
          });
        }
        break;
      case "submit":
        event.preventDefault();
        if (!event.target.checkValidity()) {
          return;
        }
      // Fall through to handle like forward event.
      case "forward":
        try {
          const stateData = this.#currentSubview.captureState?.();
          await this.#handleForwardAction(this.#currentState, stateData);
        } catch (error) {
          this.#handleAbortable();
          this.#currentSubview.showNotification({
            title: error.title || error.message,
            description: error.text,
            error,
            type: "error",
          });
        }
        break;
      case "custom-footer-action":
        try {
          await this.#handleCustomAction(this.#currentState, event);
        } catch (error) {
          this.#currentSubview.showNotification({
            title: error.title,
            description: error.text,
            error,
            type: "error",
          });
        }
        break;
      case "edit-configuration":
        this.#currentConfig = this.#fillAccountConfig(
          this.#currentSubview.captureState()
        );
        // The edit configuration button was pressed.
        await this.#initUI("incomingConfigSubview");
        // Apply the current state data to the new state.
        this.#currentSubview.setState(this.#currentConfig);
        break;
      case "config-updated":
        try {
          this.#emailFooter.toggleForwardDisabled(!event.detail.completed);
        } catch (error) {
          this.#currentSubview.showNotification({
            title: error.title,
            description: error.text,
            error,
            type: "error",
          });
        }
        break;
      case "advanced-config":
        try {
          let stateData = this.#currentSubview.captureState().config;
          if (this.#currentState === "outgoingConfigSubview") {
            stateData = this.#currentSubview.captureState();
            stateData.incoming =
              this.#states.incomingConfigSubview.subview.captureState().config.incoming;
          }
          stateData = this.#fillAccountConfig(stateData);
          await this.#advancedSetup(stateData);
        } catch (error) {
          this.#currentSubview.showNotification({
            title: error.title,
            description: error.text,
            error,
            type: "error",
          });
        }
        break;
      case "install-addon":
        try {
          this.#startLoading("account-setup-installing-addon");
          await this.#installAddon();
          // Update the add-on state in the found config list.
          this.#currentSubview.setAddon();
          this.#emailFooter.toggleForwardDisabled(false);
        } catch (error) {
          this.#currentSubview.showNotification({
            fluentTitleId: "account-hub-addon-error",
            type: "error",
          });
        }
        this.#stopLoading();
        this.#currentSubview.showNotification({
          fluentTitleId: "account-setup-success-addon",
          type: "success",
        });
        break;
      default:
        break;
    }
  }

  /**
   * Calls the appropriate method for the current state after the back/cancel
   * button is pressed.
   *
   * @param {string} currentState - The current state of the email flow.
   */
  #handleBackAction(currentState) {
    switch (currentState) {
      case "autoConfigSubview":
        this.#currentSubview.checkValidEmailForm();
        // Focus on the correct input in the auto config subview.
        this.#currentSubview.setState();
        break;
      case "incomingConfigSubview":
        // Set the currentConfig outgoing to the updated fields in the
        // outgoing form.
        this.#currentConfig.outgoing =
          this.#states.outgoingConfigSubview.subview.captureState().outgoing;
        this.#setCurrentConfigForSubview();
        break;
      case "outgoingConfigSubview":
        break;
      case "emailPasswordSubview":
        break;
      default:
        break;
    }
  }

  /**
   * Calls the appropriate method for the current state when the forward
   * button is pressed.
   *
   * @param {string} currentState - The current state of the email flow.
   * @param {object} stateData - The current state data of the email flow.
   */
  async #handleForwardAction(currentState, stateData) {
    switch (currentState) {
      case "autoConfigSubview":
        this.#startLoading("account-hub-lookup-email-configuration-title");
        try {
          this.#email = stateData.email;
          this.#realName = stateData.realName;
          const config = await this.#findConfig();

          // If the config is null, the guessConfig couldn't find anything so
          // move to the manual config form to get them to fill in details,
          // or move forward to the next step.
          if (!config) {
            this.#currentConfig = this.#fillAccountConfig(
              this.#getEmptyAccountConfig()
            );
            this.#stopLoading();
            await this.#initUI("incomingConfigSubview");
            this.#states[this.#currentState].previousStep = currentState;
            this.#currentSubview.showNotification({
              fluentTitleId: "account-hub-find-account-settings-failed",
              type: "warning",
            });
            this.#setCurrentConfigForSubview();
            break;
          }
          this.#currentConfig = this.#fillAccountConfig(config);

          if (
            Services.prefs.getBoolPref("experimental.mail.ews.enabled", true)
          ) {
            lazy.FindConfig.ewsifyConfig(this.#currentConfig);
          }

          this.#stopLoading();
          await this.#initUI(this.#states[this.#currentState].nextStep);

          this.#states.incomingConfigSubview.previousStep =
            "emailConfigFoundSubview";
          this.#currentSubview.showNotification({
            fluentTitleId: "account-hub-config-success",
            type: "success",
          });
        } catch (error) {
          this.abortable = null;
          if (!(error instanceof UserCancelledException)) {
            throw error;
          }
          break;
        }

        this.#setCurrentConfigForSubview();
        break;
      case "incomingConfigSubview":
        await this.#initUI(this.#states[this.#currentState].nextStep);
        this.#currentConfig.incoming = stateData.config.incoming;
        this.#setCurrentConfigForSubview();

        // We disable the continue button as the user needs click test to
        // ensure that the config is correct and complete, unless they don't
        // edit the incoming config.
        this.#emailFooter.toggleForwardDisabled(stateData.edited);
        // TODO: Validate incoming config details.
        break;
      case "outgoingConfigSubview":
      case "emailConfigFoundSubview":
        if (this.#currentConfig.isOauthOnly()) {
          //TODO share this with the code path for pw entry...
          this.#startLoading("account-hub-oauth-pending");
          gAccountSetupLogger.debug("Create button clicked.");
          try {
            await this.#validateAndFinish(this.#currentConfig.copy());
          } finally {
            this.#stopLoading();
          }
          await this.#initUI("emailSyncAccountsSubview");
          this.#states[this.#currentState].previousStep = currentState;
          try {
            // TODO: Loading notification for fetching address books.
            const syncAccounts = {};
            //TODO fetch address books and calendars in parallel?
            syncAccounts.addressBooks = await this.#getAddressBooks("");
            // TODO: Loading notification for fetching calendars.
            syncAccounts.calendars = await this.#getCalendars("", false);
            this.#currentSubview.setState(syncAccounts);
            this.#configVerifier.cleanup();

            const accountsFound =
              syncAccounts.addressBooks.length || syncAccounts.calendars.length;
            this.#currentSubview.showNotification({
              fluentTitleId: accountsFound
                ? "account-hub-sync-accounts-found"
                : "account-hub-sync-accounts-not-found",
              type: accountsFound ? "success" : "info",
            });
            break;
          } catch (error) {
            this.#currentSubview.showNotification({
              fluentTitleId: "account-hub-sync-accounts-not-found",
              type: "error",
              error,
            });
            break;
          }
        }
        // Move to the password stage where validateAndFinish is run.
        await this.#initUI(this.#states[this.#currentState].nextStep);
        // The password stage should now have the outgoing subview as the
        // previous step.
        this.#states[this.#currentState].previousStep = currentState;
        this.#currentSubview.setState();

        this.#currentSubview.showNotification({
          fluentTitleId: "account-hub-password-info",
          type: "info",
        });
        break;
      case "emailPasswordSubview":
        this.#startLoading("account-hub-creating-account");

        // Get password and remember from the state and apply it to the config.
        this.#currentConfig = this.#fillAccountConfig(
          this.#currentConfig,
          stateData.password
        );
        this.#currentConfig.rememberPassword = stateData.rememberPassword;
        gAccountSetupLogger.debug("Create button clicked.");

        try {
          await this.#validateAndFinish(this.#currentConfig.copy());
        } catch (error) {
          this.#stopLoading();
          throw error;
        }

        this.#stopLoading();
        await this.#initUI(this.#states[this.#currentState].nextStep);
        try {
          // TODO: Loading notification for fetching address books.
          const syncAccounts = {};
          syncAccounts.addressBooks = await this.#getAddressBooks(
            stateData.password
          );
          // TODO: Loading notification for fetching calendars.
          syncAccounts.calendars = await this.#getCalendars(
            stateData.password,
            stateData.rememberPassword
          );
          this.#currentSubview.setState(syncAccounts);
          this.#configVerifier.cleanup();
          const accountsFound =
            syncAccounts.addressBooks.length || syncAccounts.calendars.length;

          this.#currentSubview.showNotification({
            fluentTitleId: accountsFound
              ? "account-hub-sync-accounts-found"
              : "account-hub-sync-accounts-not-found",
            type: accountsFound ? "success" : "info",
          });
          break;
        } catch (error) {
          this.#currentSubview.showNotification({
            fluentTitleId: "account-hub-sync-accounts-not-found",
            type: "error",
            error,
          });
          break;
        }

      case "emailSyncAccountsSubview":
        try {
          // Add the selected sync address books and calendars.
          this.#addSyncAccounts(stateData);

          await this.#initUI(this.#states[this.#currentState].nextStep);
          this.#currentSubview.setState(this.#currentConfig);
          this.#currentSubview.showNotification({
            fluentTitleId: "account-hub-email-added-success",
            type: "success",
          });
        } catch (error) {
          this.#currentSubview.showNotification({
            fluentTitleId: "account-hub-sync-accounts-failure",
            type: "error",
            error,
          });
        }
        break;
      case "emailAddedSuccessSubview":
        this.dispatchEvent(
          new CustomEvent("request-close", {
            bubbles: true,
          })
        );
        await this.reset();
        break;
      default:
        break;
    }
  }

  /**
   * Calls the appropriate method for the current state when the custom action
   * button is pressed.
   *
   * @param {string} currentState - The current state of the email flow.
   */
  async #handleCustomAction(currentState) {
    let stateData;
    switch (currentState) {
      case "incomingConfigSubview":
        break;
      case "outgoingConfigSubview":
        this.#startLoading("account-hub-adding-account-subheader");
        stateData = this.#currentSubview.captureState();
        stateData.incoming =
          this.#states.incomingConfigSubview.subview.captureState().config.incoming;
        stateData = this.#fillAccountConfig(stateData);
        try {
          const config = await this.#guessConfig(
            this.#email.split("@")[1],
            stateData
          );
          config.validateSocketType();

          if (config.isComplete()) {
            this.#stopLoading();
            this.#currentSubview.showNotification({
              fluentTitleId: "account-setup-success-half-manual",
              type: "success",
            });
            this.#emailFooter.toggleForwardDisabled(false);
            // The config is complete, therefore we can set the currentConfig
            // as the complete config, and update the outgoing config with any
            // changes the guess config made.
            this.#currentConfig = config;
            this.#currentSubview.setState(config);
          } else {
            this.#stopLoading();
            // The config is not complete, go back to the incoming view and
            // show an error.
            this.#initUI(this.#states[this.#currentState].previousStep);
            this.#currentSubview.showNotification({
              fluentTitleId: "account-hub-find-account-settings-failed",
              type: "error",
            });
          }
        } catch (error) {
          this.#stopLoading();
          this.#initUI(this.#states[this.#currentState].previousStep);
          this.#currentSubview.showNotification({
            fluentTitleId: "account-setup-find-settings-failed",
            error,
            type: "error",
          });
        }
        break;
      case "emailAddedSuccessSubview":
        await this.reset();
        break;
      default:
        break;
    }
  }

  /**
   * Handles aborting the current action that is loading.
   */
  #handleAbortable() {
    if (this.abortable) {
      this.abortable.cancel(new UserCancelledException());
      this.abortable = null;
    }
  }

  /**
   * Apply the new state data to the new state by passing a deep copy.
   * We pass a deep copy because this controller's #currentConfig should
   * only be updated when appropriate. (Eg. Updating incoming config and
   * going back should not show the edited fields in config found view).
   */
  #setCurrentConfigForSubview() {
    const config = this.#currentConfig.copy();
    this.#currentSubview.setState(config);
  }

  /**
   * Finds an account configuration from the provided data if available.
   *
   * @returns {?AccountConfig} @see AccountConfig.sys.mjs
   */
  async #findConfig() {
    if (this.abortable) {
      this.#handleAbortable();
    }

    const emailSplit = this.#email.split("@");
    const domain = emailSplit[1];
    const initialConfig = new lazy.AccountConfig();
    const emailLocal = lazy.Sanitizer.nonemptystring(emailSplit[0]);
    initialConfig.incoming.username = emailLocal;
    initialConfig.outgoing.username = emailLocal;

    gAccountSetupLogger.debug("findConfig()");
    this.abortable = new SuccessiveAbortable();
    let config = null;

    // This can throw an error which will be caught up the call stack
    // to show the correct notification.
    config = await lazy.FindConfig.parallelAutoDiscovery(
      this.abortable,
      domain,
      this.#email
    );

    this.abortable = null;

    if (!config) {
      try {
        config = await this.#guessConfig(domain, initialConfig);
      } catch (error) {
        if (error instanceof UserCancelledException) {
          throw error;
        }
      }
    }

    if (config) {
      try {
        config = await this.#getExchangeAddons(config);
      } catch (error) {
        if (error instanceof UserCancelledException) {
          throw error;
        }
      }
    }

    this.abortable = null;
    return config;
  }

  /**
   * Guess an account configuration with the provided domain.
   *
   * @param {string} domain - The domain from the email address.
   * @param {AccountConfig} initialConfig - Account Config object.
   *
   * @returns {Promise} - A promise waiting for guessConfig to complete.
   */
  #guessConfig(domain, initialConfig) {
    let configType = "both";

    if (initialConfig.outgoing?.existingServerKey) {
      configType = "incoming";
    }

    const { promise, resolve, reject } = Promise.withResolvers();
    this.abortable = lazy.GuessConfig.guessConfig(
      domain,
      (type, hostname, port, socketType) => {
        // The guessConfig search progress is ongoing.
        gAccountSetupLogger.debug(
          `${hostname}:${port} socketType=${socketType} ${type}: progress callback`
        );
      },
      config => {
        // The guessConfig was successful.
        this.abortable = null;
        resolve(config);
      },
      error => {
        gAccountSetupLogger.warn(`guessConfig failed: ${error}`);
        reject(error);
        this.abortable = null;
      },
      initialConfig,
      configType
    );

    return promise;
  }

  /**
   * Only active in manual edit mode, and goes straight into
   * Account Settings tab. Requires a backend account,
   * which requires proper hostname, port and protocol.
   *
   * @param {AccountConfig} accountConfig - Account Config object.
   */
  async #advancedSetup(accountConfig) {
    if (lazy.CreateInBackend.checkIncomingServerAlreadyExists(accountConfig)) {
      throw new Error("Account already exists.", {
        cause: {
          fluentTitleId: "account-setup-creation-error-title",
          fluentDescriptionId: "account-setup-error-server-exists",
        },
      });
    }

    const [title, description] = await lazy.l10n.formatValues([
      "account-setup-confirm-advanced-title",
      "account-setup-confirm-advanced-description",
    ]);

    // TODO: Create a custom styled dialog instead of using the old one.
    if (!Services.prompt.confirm(null, title, description)) {
      return;
    }

    gAccountSetupLogger.debug("Creating account in backend.");
    const newAccount =
      await lazy.CreateInBackend.createAccountInBackend(accountConfig);

    await this.#moveToAccountManager(newAccount.incomingServer);
  }

  /**
   * Adds name and email address to AccountConfig object.
   *
   * @param {AccountConfig} configData - AccountConfig from findConfig().
   * @param {string} [password=""] - The password for the account.
   * @returns {AccountConfig} - The concrete AccountConfig object.
   */
  #fillAccountConfig(configData, password = "") {
    lazy.AccountConfig.replaceVariables(
      configData,
      this.#realName,
      this.#email,
      password
    );

    return configData;
  }

  /**
   * Called when guessConfig fails and we need to provide manual config a
   * default AccountConfig.
   */
  #getEmptyAccountConfig() {
    const config = new lazy.AccountConfig();
    config.incoming.type = "imap";
    config.incoming.username = "%EMAILADDRESS%";
    config.outgoing.username = "%EMAILADDRESS%";
    config.incoming.hostname = ".%EMAILDOMAIN%";
    config.outgoing.hostname = ".%EMAILDOMAIN%";

    return config;
  }

  /**
   * Called from the "onContinue" function, does final validation on the
   * the complete config that is provided by the user and modified by helper.
   *
   * @param {AccountConfig} completeConfig - The completed config.
   */
  async #validateAndFinish(completeConfig) {
    if (
      completeConfig.incoming.type == "exchange" &&
      "addonAccountType" in completeConfig.incoming
    ) {
      completeConfig.incoming.type = completeConfig.incoming.addonAccountType;
    }

    if (lazy.CreateInBackend.checkIncomingServerAlreadyExists(completeConfig)) {
      throw new Error("Account already exists.", {
        cause: {
          fluentTitleId: "account-setup-creation-error-title",
          fluentDescriptionId: "account-setup-error-server-exists",
        },
      });
    }

    if (completeConfig.outgoing.addThisServer) {
      const existingServer =
        lazy.CreateInBackend.checkOutgoingServerAlreadyExists(completeConfig);
      if (existingServer) {
        completeConfig.outgoing.addThisServer = false;
        completeConfig.outgoing.existingServerKey = existingServer.key;
      }
    }

    const telemetryKey =
      this.#currentConfig.source == lazy.AccountConfig.kSourceXML ||
      this.#currentConfig.source == lazy.AccountConfig.kSourceExchange
        ? this.#currentConfig.subSource
        : this.#currentConfig.source;

    // This verifies the the current config and, if needed, opens up an
    // additional window for authentication.
    this.#configVerifier = new lazy.ConfigVerifier(window.msgWindow);
    try {
      const successfulConfig = await this.#configVerifier.verifyConfig(
        completeConfig,
        completeConfig.source != lazy.AccountConfig.kSourceXML
      );
      // The auth might have changed, so we should update the current config.
      this.#currentConfig.incoming.auth = successfulConfig.incoming.auth;
      this.#currentConfig.outgoing.auth = successfulConfig.outgoing.auth;
      this.#currentConfig.incoming.username =
        successfulConfig.incoming.username;
      this.#currentConfig.outgoing.username =
        successfulConfig.outgoing.username;

      this.#currentConfig = completeConfig;
      this.#finishEmailAccountAddition(completeConfig);
      Glean.mail.successfulEmailAccountSetup[telemetryKey].add(1);
    } catch (error) {
      // If we get no message, then something other than VerifyLogon failed.
      let errorTitle = "account-hub-account-authentication-error";
      // For an Exchange server, some known configurations can
      // be disabled (per user or domain or server).
      // Warn the user if the open protocol we tried didn't work.
      if (
        ["imap", "pop3"].includes(completeConfig.incoming.type) &&
        completeConfig.incomingAlternatives.some(i => i.type == "exchange")
      ) {
        errorTitle = "account-setup-exchange-config-unverifiable";
      }

      this.#configVerifier.cleanup();
      Glean.mail.failedEmailAccountSetup[telemetryKey].add(1);

      throw new Error(error.message, {
        cause: {
          fluentTitleId: errorTitle,
        },
      });
    }
  }

  /**
   * Created the account in the backend and starts loading messages. This
   * method also leads to the account added view where the user can add more
   * accounts (calendar, address book, etc.)
   *
   * @param {AccountConfig} completeConfig - The completed config
   */
  async #finishEmailAccountAddition(completeConfig) {
    gAccountSetupLogger.debug("Creating account in backend.");
    const emailAccount =
      await lazy.CreateInBackend.createAccountInBackend(completeConfig);
    emailAccount.incomingServer.getNewMessages(
      emailAccount.incomingServer.rootFolder,
      window.msgWindow,
      null
    );
  }

  /**
   * Get the address books associated with the current account.
   *
   * @param {string} password - The password for the current account.
   *
   * @returns {Array} - The address books assoicated with the account.
   */
  async #getAddressBooks(password) {
    let addressBooks = [];

    // Bail out if the CardDAV scope wasn't granted.
    if (this.#currentConfig.incoming.auth == Ci.nsMsgAuthMethod.OAuth2) {
      const oAuth2 = new lazy.OAuth2Module();
      if (
        !oAuth2.initFromHostname(
          this.#currentConfig.incoming.hostname,
          this.#currentConfig.incoming.username,
          "carddav"
        ) ||
        !oAuth2.getRefreshToken()
      ) {
        return addressBooks;
      }
    }

    const hostname = this.#email.split("@")[1];
    try {
      addressBooks = await lazy.CardDAVUtils.detectAddressBooks(
        this.#email,
        password,
        `https://${hostname}`,
        false
      );
    } catch (error) {
      gAccountSetupLogger.debug(
        `Found no address books for ${this.#email} on ${hostname}.`,
        error
      );
      return addressBooks;
    }

    const existingAddressBookUrls = lazy.MailServices.ab.directories.map(d =>
      d.getStringValue("carddav.url", "")
    );

    addressBooks = addressBooks.map(addressBook => {
      addressBook.existing = existingAddressBookUrls.includes(
        addressBook.url.href
      );
      return addressBook;
    });

    return addressBooks;
  }

  /**
   * Get the calendars associated with the current account.
   *
   * @param {string} password - The password for the current account.
   * @param {boolean} rememberPassword - The remember password choice.
   *
   * @returns {Array} - The calendars assoicated with the account.
   */
  async #getCalendars(password, rememberPassword) {
    let calendarEntries = null;
    const cals = [];

    // Bail out if the CalDAV scope wasn't granted.
    if (this.#currentConfig.incoming.auth == Ci.nsMsgAuthMethod.OAuth2) {
      const oAuth2 = new lazy.OAuth2Module();
      if (
        !oAuth2.initFromHostname(
          this.#currentConfig.incoming.hostname,
          this.#currentConfig.incoming.username,
          "caldav"
        ) ||
        !oAuth2.getRefreshToken()
      ) {
        return cals;
      }
    }

    const hostname = this.#email.split("@")[1];

    try {
      calendarEntries = await lazy.cal.provider.detection.detect(
        this.#email,
        password,
        `https://${hostname}`,
        rememberPassword,
        [],
        {}
      );
    } catch (error) {
      gAccountSetupLogger.debug(
        `Found no calendars for ${this.#email} on ${hostname}.`,
        error
      );
      return cals;
    }

    // If no calendars return empty array.
    if (!calendarEntries.size) {
      return cals;
    }

    // Collect existing calendars to compare with the list of recently fetched
    // ones.
    const existing = new Set(
      lazy.cal.manager.getCalendars({}).map(calendar => calendar.uri.spec)
    );

    for (const calendars of calendarEntries.values()) {
      for (const calendar of calendars) {
        if (existing.has(calendar.uri.spec)) {
          cals.push({ name: calendar.name, existing: true });
          continue;
        }
        cals.push(calendar);
      }
    }
    return cals;
  }

  /**
   * @typedef {object} SyncAccounts
   * @property {Array} calendars - The selected calendars.
   * @property {Array} addressBooks - The selected address books.
   */

  /**
   * Adds selected calendars and address books to Thunderbird.
   *
   * @param {SyncAccounts[]} syncAccounts - The sync accounts for the user.
   */
  #addSyncAccounts(syncAccounts) {
    for (const calendar of syncAccounts.calendars) {
      lazy.cal.manager.registerCalendar(calendar);
    }

    for (const addressBook of syncAccounts.addressBooks) {
      addressBook.create();
    }
  }

  /**
   * Add the applicable exchange add-on options to the config object.
   *
   * @param {AccountConfig} config - Account Config object.
   * @returns {Promise} - A promise waiting for getAddonsList to complete.
   */
  async #getExchangeAddons(config) {
    const { promise, resolve, reject } = Promise.withResolvers();

    this.abortable = lazy.getAddonsList(
      config,
      () => {
        resolve(config);
      },
      error => {
        // We reject here, but this will silently fail as we don't need to
        // show the user if we were unable to find add-ons for the conifg.
        gAccountSetupLogger.warn(`getExchangeAddons failed: ${error}`);
        reject(error);
      }
    );

    return promise;
  }

  /**
   * Installs the first available add-on in the config object for exchange.
   */
  async #installAddon() {
    const addon = this.#currentConfig.addons[0];
    const installer = (this.abortable = new AddonInstaller(addon));
    await installer.install();
    this.abortable = null;
  }

  /**
   * Request the opening of the account manager after the creation of a new
   * account and reset any leftover data in the current setup flow.
   *
   * @param {object} data - The data passed to the template.
   */
  async #moveToAccountManager(data) {
    this.dispatchEvent(
      new CustomEvent("request-close", {
        bubbles: true,
      })
    );
    // eslint-disable-next-line no-undef
    MsgAccountManager("am-server.xhtml", data);
    await this.reset();
  }

  /**
   * Check if any operation is currently in process and return true only if we
   * can leave this view.
   *
   * @returns {boolean} - If the account hub can remove this view.
   */
  async reset() {
    if (this.abortable) {
      return false;
    }

    this.#stopLoading();
    await this.#initUI("autoConfigSubview");
    this.#currentState = "autoConfigSubview";
    this.#currentConfig = {};
    this.#hideSubviews();
    this.#clearNotifications();
    this.#currentSubview.hidden = false;
    this.#setFooterButtons();
    // Reset all subviews that require a reset.
    for (const subviewName of Object.keys(this.#states)) {
      this.#states[subviewName].subview?.resetState?.();
    }
    this.#emailFooter.toggleForwardDisabled(true);
    return true;
  }
}

customElements.define("account-hub-email", AccountHubEmail);
