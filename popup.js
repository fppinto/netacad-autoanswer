document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("apiKey");
  const claudeModelSelect = document.getElementById("claudeModel");
  const saveKeyButton = document.getElementById("saveKey");
  const processPageButton = document.getElementById("processPage");
  const statusDiv = document.getElementById("status");
  const showAnswersToggle = document.getElementById("showAnswersToggle");
  const processOnSwitchToggle = document.getElementById("processOnSwitchToggle");

  chrome.storage.sync.get(
    [
      "anthropicApiKey",
      "claudeModel",
      "showAnswers",
      "processOnSwitch",
    ],
    (result) => {
      if (result.anthropicApiKey) apiKeyInput.value = result.anthropicApiKey;
      if (result.claudeModel) {
        // Make sure stored value exists in dropdown; if not, append it.
        if (![...claudeModelSelect.options].some((o) => o.value === result.claudeModel)) {
          const opt = document.createElement("option");
          opt.value = result.claudeModel;
          opt.textContent = result.claudeModel + " (custom)";
          claudeModelSelect.appendChild(opt);
        }
        claudeModelSelect.value = result.claudeModel;
      }

      statusDiv.textContent = result.anthropicApiKey ? "Settings loaded." : "API Key not set.";

      if (typeof result.showAnswers === "boolean") {
        showAnswersToggle.checked = result.showAnswers;
      } else {
        showAnswersToggle.checked = true;
      }
      if (typeof result.processOnSwitch === "boolean") {
        processOnSwitchToggle.checked = result.processOnSwitch;
      } else {
        processOnSwitchToggle.checked = true;
      }

      setTimeout(() => {
        if (
          statusDiv.textContent === "Settings loaded." ||
          statusDiv.textContent === "API Key not set."
        )
          statusDiv.textContent = "";
      }, 2000);
    },
  );

  showAnswersToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ showAnswers: showAnswersToggle.checked });
  });

  processOnSwitchToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ processOnSwitch: processOnSwitchToggle.checked });
  });

  saveKeyButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    const model = claudeModelSelect.value;
    if (!apiKey) {
      statusDiv.textContent = "Please enter Anthropic API Key.";
      return;
    }
    chrome.storage.sync.set({ anthropicApiKey: apiKey, claudeModel: model }, () => {
      statusDiv.textContent = "Settings saved!";
      setTimeout(() => (statusDiv.textContent = ""), 2000);
    });
  });

  processPageButton.addEventListener("click", () => {
    statusDiv.textContent = "Sending command to page...";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(
          tabId,
          { action: "processPage", showAnswers: showAnswersToggle.checked },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Popup Error: Error sending message to content script: ",
                chrome.runtime.lastError.message,
              );
              statusDiv.textContent = `Error: Could not communicate with page. Details: ${chrome.runtime.lastError.message}`;
            } else if (response) {
              if (response.success) {
                if (response.result === true) {
                  statusDiv.textContent = "Processing started on page.";
                } else if (response.result === false) {
                  statusDiv.textContent =
                    "Processed: No questions found on page or Show Answers is disabled.";
                } else {
                  statusDiv.textContent =
                    "Page responded, but with an unexpected result from scrapeData.";
                }
              } else {
                statusDiv.textContent = `Error on page: ${response.error || "Unknown error"}`;
              }
            } else {
              statusDiv.textContent =
                "No response from page. Is it a NetAcad quiz page with questions?";
            }
            setTimeout(() => {
              if (statusDiv.textContent !== "") statusDiv.textContent = "";
            }, 4000);
          },
        );
      } else {
        statusDiv.textContent = "Error: Could not find active tab.";
      }
    });
  });
});
