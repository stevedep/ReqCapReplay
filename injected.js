(function() {
  ///////////////////////////////
  // Helper Function
  ///////////////////////////////
  // Extract a value from an object using a dot-separated path.
  function getValueByPath(obj, path) {
    const parts = path.split('.');
    let value = obj;
    for (let p of parts) {
      if (value && p in value) {
        value = value[p];
      } else {
        return undefined;
      }
    }
    return value;
  }
  
  ///////////////////////////////
  // Define BrowserUtils
  ///////////////////////////////
  // Store the native fetch function (without binding) so its native properties are preserved.
  const nativeFetch = window.fetch;
  
  // Default configuration values.
  const defaultConfig = {
    filter: "opendata.rdw.nl/api/catalog/v1",  // Substring to search for in the URL.
    paramName: "page",                           // Query parameter to update.
    pageSize: 20,                                // Increment value.
    jsonPath: "data.recipeSearchV2.result"       // Dot‑separated JSON path to extract.
  };
  
  window.BrowserUtils = {
    originalFetch: nativeFetch,
    firstCapture: null,
    config: Object.assign({}, defaultConfig),
  
    // Read configuration from the panel inputs.
    updateConfigFromPanel() {
      this.config.filter = document.getElementById('filter').value.trim();
      this.config.paramName = document.getElementById('paramName').value.trim();
      this.config.pageSize = parseInt(document.getElementById('pageSize').value, 10) || defaultConfig.pageSize;
      this.config.jsonPath = document.getElementById('jsonPath').value.trim();
      console.log('Configuration updated:', this.config);
    },
  
    // Monitor fetch calls by wrapping nativeFetch in a Proxy.
    monitorGQL() {
      window.fetch = new Proxy(nativeFetch, {
        apply: function(target, thisArg, args) {
          try {
            const [resource, config = {}] = args;
            const url = typeof resource === 'string' ? resource : resource.url;
  
            // If the URL matches the configured filter, update the capture.
            if (BrowserUtils.config.filter && url.includes(BrowserUtils.config.filter)) {
              const cleanConfig = {
                headers: config.headers || {},
                method: config.method || 'GET',
                mode: config.mode || 'cors',
                credentials: config.credentials || 'same-origin'
              };
              if (config.body) {
                try {
                  const bodyObj = JSON.parse(config.body);
                  cleanConfig.body = JSON.stringify(bodyObj, null, 2);
                } catch (e) {
                  cleanConfig.body = config.body;
                }
              }
              BrowserUtils.firstCapture = { url, config: cleanConfig };
              console.log('Fetch Captured and Stored!');
  
              const referer =
                cleanConfig.headers['referer'] ||
                cleanConfig.headers['Referer'] ||
                document.referrer ||
                window.location.href;
              const fetchStatusEl = document.getElementById('fetch-status');
              if (fetchStatusEl) {
                let preview = `${cleanConfig.method || 'GET'} ${url}`;
                if (preview.length > 50) preview = preview.slice(0, 50) + '...';
                fetchStatusEl.textContent = 'Captured: ' + preview + ` (Referer: ${referer})`;
              }
            }
          } catch (e) {
            console.error('Error in fetch override:', e);
          }
          return Reflect.apply(target, thisArg, args);
        }
      });
      console.log('%cFetch Monitoring Activated', 'color: #2ecc71; font-size: 12px;');
    },
  
    // Disable monitoring: restore the native fetch, remove the panel, and reload the page.
    disableMonitoring() {
      window.fetch = this.originalFetch;
      console.log('%cMonitoring Disabled. Original fetch restored.', 'color: #e74c3c; font-size: 12px;');
      const panelElem = document.getElementById('browserutils-panel');
      if (panelElem) {
        panelElem.remove();
      }
      window.location.reload();
    },
  
    // Clears the stored capture.
    clearCapture() {
      this.firstCapture = null;
      const fetchStatusEl = document.getElementById('fetch-status');
      if (fetchStatusEl) {
        fetchStatusEl.textContent = 'No capture';
      }
      console.log('Capture cleared.');
    },
  
    // Executes a request by updating the captured URL's query parameter.
    async executeRequest(newValue) {
      if (!this.firstCapture) {
        throw new Error('No request captured. Please browse to capture a request.');
      }
      try {
        const config = JSON.parse(JSON.stringify(this.firstCapture.config));
        let origUrl = this.firstCapture.url;
        let updatedUrl;
        try {
          const urlObj = new URL(origUrl);
          urlObj.searchParams.set(this.config.paramName, newValue);
          updatedUrl = urlObj.toString();
        } catch (err) {
          console.warn('Error parsing URL; using original URL:', err);
          updatedUrl = origUrl;
        }
        console.log(`Executing request with ${this.config.paramName}=${newValue}:`);
        const response = await fetch(updatedUrl, config);
        return await response.json();
      } catch (error) {
        console.error('Error executing request:', error);
        throw error;
      }
    },
  
    // Utility: sleep for a given number of milliseconds.
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
  
    // Downloads JSON data as a file.
    download(filename, data) {
      const element = document.createElement("a");
      element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2)));
      element.setAttribute("download", filename);
      element.style.display = "none";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    },
  
    // Collects data from multiple pages and downloads the aggregated result.
    async collectAndDownload(startValue = 0, totalPages = 3) {
      if (!this.firstCapture) {
        console.error('No request captured. Please browse to capture a request.');
        return;
      }
      const pageSize = this.config.pageSize;
      console.log(`Collecting data from ${totalPages} pages starting with ${this.config.paramName}=${startValue}...`);
      const result = [];
      for (let i = 0; i < totalPages; i++) {
        const newValue = startValue + i * pageSize;
        try {
          if (i > 0) await this.sleep(1000);
          const data = await this.executeRequest(newValue);
          const extracted = getValueByPath(data, this.config.jsonPath);
          if (extracted !== undefined) {
            result.push(extracted);
            console.log(`Collected page ${i} (${this.config.paramName}=${newValue})`);
          } else {
            console.error(`Data not found at path "${this.config.jsonPath}" for ${this.config.paramName}=${newValue}`);
          }
        } catch (error) {
          console.error(`Error collecting page ${i}:`, error);
        }
      }
      if (result.length > 0) {
        this.download("data.json", result);
        console.log('Data collection complete! File "data.json" downloaded.');
      } else {
        console.error('No data collected.');
      }
    }
  };
  
  ///////////////////////////////
  // Extend to Capture XHR Calls
  ///////////////////////////////
  // Save the original XHR methods.
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  
  // Override open: store method and URL on the instance.
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this._xhrMethod = method;
    this._xhrUrl = url;
    this._xhrHeaders = {};
    return originalXHROpen.apply(this, arguments);
  };
  
  // Override setRequestHeader to capture headers.
  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (!this._xhrHeaders) { this._xhrHeaders = {}; }
    this._xhrHeaders[header] = value;
    return originalXHRSetRequestHeader.apply(this, arguments);
  };
  
  // Override send to log every XHR and capture matching ones.
  XMLHttpRequest.prototype.send = function(body) {
    // Log every XHR call.
   // console.log("XHR sent:", this._xhrMethod, this._xhrUrl, "body:", body, "headers:", this._xhrHeaders);
  
    const filter = window.BrowserUtils && window.BrowserUtils.config ? window.BrowserUtils.config.filter : "";
    if (this._xhrUrl && filter && this._xhrUrl.includes(filter)) {
      const cleanConfig = {
        headers: this._xhrHeaders || {},
        method: this._xhrMethod || 'GET'
      };
      if (body) {
        try {
          const bodyObj = JSON.parse(body);
          cleanConfig.body = JSON.stringify(bodyObj, null, 2);
        } catch (e) {
          cleanConfig.body = body;
        }
      }
      window.BrowserUtils.firstCapture = { url: this._xhrUrl, config: cleanConfig };
      console.log("XHR Captured and Stored!");
      const referer =
        cleanConfig.headers['referer'] ||
        cleanConfig.headers['Referer'] ||
        document.referrer ||
        window.location.href;
      const fetchStatusEl = document.getElementById("fetch-status");
      if (fetchStatusEl) {
        let preview = `${cleanConfig.method || 'GET'} ${this._xhrUrl}`;
        if (preview.length > 50) preview = preview.slice(0, 50) + '...';
        fetchStatusEl.textContent = "Captured: " + preview + ` (Referer: ${referer})`;
      }
    }
    return originalXHRSend.apply(this, arguments);
  };
  
  ///////////////////////////////
  // Build the Floating Panel UI
  ///////////////////////////////
  
  // Create a container for the UI and assign an ID.
  const panel = document.createElement('div');
  panel.id = 'browserutils-panel';
  // Position the panel at the top right.
  panel.style.position = 'fixed';
  panel.style.top = '20px';
  panel.style.right = '20px';
  panel.style.zIndex = '10000';
  panel.style.backgroundColor = '#fff';
  panel.style.border = '1px solid #e0e0e0';
  panel.style.borderRadius = '8px';
  panel.style.padding = '20px';
  panel.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.1)';
  panel.style.fontFamily = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
  panel.style.fontSize = '14px';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '15px';
  
  // Build the panel inner HTML.
  panel.innerHTML = `
    <div style="text-align: center; font-weight: bold; margin-bottom: 5px;">Configuration</div>
    <div style="display: flex; flex-direction: column; gap: 5px;">
      <label>Filter (in URL):
        <input id="filter" type="text" value="${defaultConfig.filter}" style="width: 100%;" />
      </label>
      <label>Parameter Name:
        <input id="paramName" type="text" value="${defaultConfig.paramName}" style="width: 100%;" />
      </label>
      <label>Page Size:
        <input id="pageSize" type="number" value="${defaultConfig.pageSize}" style="width: 100%;" />
      </label>
      <label>JSON Path:
        <input id="jsonPath" type="text" value="${defaultConfig.jsonPath}" style="width: 100%;" />
      </label>
    </div>
    <div style="display: flex; justify-content: center;">
      <button id="update-config-btn" class="ah-btn" style="background-color: #8e44ad;">
        Update Config
      </button>
    </div>
    <hr style="margin: 5px 0;" />
    <div style="display: flex; justify-content: center;">
      <button id="monitor-btn" class="ah-btn">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="#fff">
          <polygon points="6,4 12,8 6,12"/>
        </svg>
        Monitor GQL
      </button>
    </div>
    <div id="fetch-status" style="text-align: center; font-size: 12px; color: #555;">No capture</div>
    <div style="display: flex; justify-content: center;">
      <button id="clear-btn" class="ah-btn" style="background-color: #e74c3c;">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="#fff">
          <rect x="4" y="4" width="8" height="8"/>
        </svg>
        Clear Capture
      </button>
    </div>
    <div style="display: flex; justify-content: center; gap: 10px;">
      <div>
        <label for="startValue">Start:</label>
        <input id="startValue" type="number" value="0" style="width: 80px; padding: 4px; margin-left:5px;" />
      </div>
      <div>
        <label for="count">Count:</label>
        <input id="count" type="number" value="1" style="width: 80px; padding: 4px; margin-left:5px;" />
      </div>
    </div>
    <div style="display: flex; justify-content: center;">
      <button id="download-btn" class="ah-btn" style="background-color: #3498db;">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="#fff">
          <path d="M8 1v10M5 8l3 3 3-3"/>
        </svg>
        Collect & Download
      </button>
    </div>
    <div style="display: flex; justify-content: center;">
      <button id="disable-btn" class="ah-btn" style="background-color: #f39c12;">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="#fff">
          <path d="M2 2l12 12M14 2L2 14"/>
        </svg>
        Disable Monitoring
      </button>
    </div>
  `;
  
  // Define a CSS block for the buttons.
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .ah-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      background-color: #007cba;
      border: none;
      border-radius: 20px;
      padding: 8px 16px;
      color: #fff;
      font-size: 14px;
      font-weight: bold;
      transition: background-color 0.3s ease;
    }
    .ah-btn:hover {
      background-color: #005a9e;
    }
    label {
      font-weight: bold;
    }
  `;
  document.head.appendChild(styleEl);
  
  // Helper: Append the panel when document.body is ready.
  function addPanelToBody(panel, callback) {
    if (document.body) {
      document.body.appendChild(panel);
      if (callback) callback();
    } else {
      document.addEventListener("DOMContentLoaded", function() {
        document.body.appendChild(panel);
        if (callback) callback();
      });
    }
  }
  
  // Attach event listeners to the UI elements.
  function addUIEventListeners() {
    const updateConfigBtn = document.getElementById('update-config-btn');
    const monitorBtn = document.getElementById('monitor-btn');
    const clearBtn = document.getElementById('clear-btn');
    const downloadBtn = document.getElementById('download-btn');
    const disableBtn = document.getElementById('disable-btn');
  
    if (updateConfigBtn) {
      updateConfigBtn.addEventListener('click', function() {
        BrowserUtils.updateConfigFromPanel();
      });
    }
    if (monitorBtn) {
      monitorBtn.addEventListener('click', function() {
        BrowserUtils.monitorGQL();
        monitorBtn.style.backgroundColor = '#2ecc71';
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        BrowserUtils.clearCapture();
      });
    }
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async function() {
        const startValue = parseInt(document.getElementById('startValue').value, 10);
        const totalPages = parseInt(document.getElementById('count').value, 10);
        await BrowserUtils.collectAndDownload(startValue, totalPages);
      });
    }
    if (disableBtn) {
      disableBtn.addEventListener('click', function() {
        BrowserUtils.disableMonitoring();
      });
    }
  }
  
  addPanelToBody(panel, addUIEventListeners);
  
  console.log('%cBrowserUtils initialized successfully!', 'color: #2ecc71; font-size: 14px; font-weight: bold;');
  console.log('%cUsage:\n- Update config if needed and click "Monitor GQL" to start capturing.\n- Browse the site to capture a request.\n- Click "Clear Capture" to remove the stored capture so a new one can be taken.\n- Click "Disable Monitoring" to restore native fetch and refresh the page.\n- Then click "Collect & Download" to download data.', 'color: #3498db; font-size: 12px;');
})();
