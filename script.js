// ======================================
// BOOMBER X CONFIGURATION
// ======================================

// Apni doosri website ka URL yahan set karo.
const MY_WEBSITE_URL = "https://mytoolstown.com/smsbomber/";

const $ = (id) => document.getElementById(id);

$("otherWebsite").href = MY_WEBSITE_URL;
$("otherWebsite").target = "_blank";
$("otherWebsite").rel = "noopener noreferrer";

// ======================================
// DEVICE INFORMATION
// ======================================

function getDeviceInfo() {
  const ua = navigator.userAgent || "";
  const uaData = navigator.userAgentData;

  return {
    deviceType: /Android|iPhone|iPad|Mobile/i.test(ua)
      ? "Mobile or tablet"
      : "Desktop or other device",

    browser: uaData?.brands?.map(
      (item) => `${item.brand} ${item.version}`
    ).join(", ") || "Browser details limited",

    operatingSystem: uaData?.platform ||
      (/Android/i.test(ua) ? "Android" :
       /iPhone|iPad|iPod/i.test(ua) ? "iOS" :
       /Windows/i.test(ua) ? "Windows" :
       /Mac OS/i.test(ua) ? "macOS" :
       /Linux/i.test(ua) ? "Linux" : "Unknown"),

    language: navigator.language || "Unavailable",

    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

    screenResolution: `${screen.width} × ${screen.height}`,

    pixelRatio: window.devicePixelRatio || 1,

    viewport: `${innerWidth} × ${innerHeight}`,

    touchPoints: navigator.maxTouchPoints || 0,

    cookiesEnabled: navigator.cookieEnabled,

    logicalCpuCores: navigator.hardwareConcurrency || "Unavailable",

    deviceMemoryGB: navigator.deviceMemory || "Unavailable",

    platform: navigator.platform || "Unavailable"
  };
}

function renderInfo(info) {
  const labels = {
    deviceType: "Device Type",
    browser: "Browser",
    operatingSystem: "Operating System",
    language: "Browser Language",
    timezone: "Timezone",
    screenResolution: "Screen Resolution",
    pixelRatio: "Pixel Ratio",
    viewport: "Browser Window",
    touchPoints: "Touch Points",
    cookiesEnabled: "Cookies Enabled",
    logicalCpuCores: "Logical CPU Cores",
    deviceMemoryGB: "Approx. Device Memory (GB)",
    platform: "Platform"
  };

  $("deviceInfo").replaceChildren();

  for (const [key, label] of Object.entries(labels)) {
    const item = document.createElement("div");
    item.className = "info-item";

    const title = document.createElement("span");
    title.className = "info-label";
    title.textContent = label;

    const value = document.createElement("span");
    value.className = "info-value";
    value.textContent = String(info[key] ?? "Unavailable");

    item.append(title, value);
    $("deviceInfo").appendChild(item);
  }
}

renderInfo(getDeviceInfo());

$("refreshBtn").addEventListener("click", () => {
  renderInfo(getDeviceInfo());
  $("status").textContent = "Device information refreshed.";
});

// ======================================
// SELECTED INFORMATION REPORT
// ======================================

async function collectSelectedInfo() {
  if (!$("consent").checked) {
    throw new Error(
      "Please tick the consent checkbox before sharing information."
    );
  }

  const report = {};

  if ($("shareDevice").checked) {
    report.device = getDeviceInfo();
  }

  if ($("shareBattery").checked) {
    if ("getBattery" in navigator) {
      try {
        const battery = await navigator.getBattery();

        report.battery = {
          levelPercent: Math.round(battery.level * 100),
          charging: battery.charging
        };
      } catch {
        report.battery = "Permission or browser support unavailable";
      }
    } else {
      report.battery = "Not supported by this browser";
    }
  }

  if ($("shareNetwork").checked) {
    const connection =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;

    report.network = connection
      ? {
          effectiveType: connection.effectiveType || "Unavailable",
          downlinkMbps: connection.downlink || "Unavailable",
          rttMs: connection.rtt || "Unavailable",
          saveData: connection.saveData ?? false
        }
      : {
          status: "Network details not exposed by this browser"
        };
  }

  if ($("shareLocation").checked) {
    report.location = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location is not supported."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy
        }),

        () => reject(
          new Error(
            "Location was not provided. Check browser permission."
          )
        ),

        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }

  return report;
}

$("shareBtn").addEventListener("click", async () => {
  const button = $("shareBtn");

  button.disabled = true;
  $("status").textContent = "Preparing your selected information...";

  try {
    const report = await collectSelectedInfo();

    const response = await fetch("/api/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(report)
    });

    let result = {};

    try {
      result = await response.json();
    } catch {
      // Response body may not be JSON.
    }

    if (!response.ok) {
      throw new Error(
        result.error || "Could not submit report."
      );
    }

    $("status").textContent =
      "Your selected information was submitted successfully.";

  } catch (error) {
    $("status").textContent = error.message;

  } finally {
    button.disabled = false;
  }
});

// ======================================
// LIVE LOCATION — USER-CONTROLLED
// ======================================

let locationWatcher = null;
let lastLocationSentAt = 0;
let liveLocationBusy = false;

const LIVE_LOCATION_MIN_INTERVAL_MS = 10000;

function setLiveLocationStatus(message) {
  const status = $("liveLocationStatus");

  if (status) {
    status.textContent = message;
  }
}

function stopLiveLocation(
  message = "Live location sharing stopped."
) {
  if (locationWatcher !== null) {
    navigator.geolocation.clearWatch(locationWatcher);
    locationWatcher = null;
  }

  $("startLiveLocationBtn").disabled = false;
  $("stopLiveLocationBtn").disabled = true;

  setLiveLocationStatus(message);
}

async function sendLiveLocation(position) {
  if (locationWatcher === null) {
    return;
  }

  if (!$("consent").checked) {
    stopLiveLocation(
      "Sharing stopped because consent was unchecked."
    );
    return;
  }

  const now = Date.now();

  // Avoid too many requests.
  if (
    now - lastLocationSentAt < LIVE_LOCATION_MIN_INTERVAL_MS ||
    liveLocationBusy
  ) {
    return;
  }

  const coords = position.coords;

  const report = {
    type: "live_location_update",
    sharing: "user_started_and_can_stop",
    timestamp: new Date().toISOString(),

    location: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracyMeters: coords.accuracy,

      googleMapsUrl:
        `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`
    }
  };

  liveLocationBusy = true;

  try {
    const response = await fetch("/api/report", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(report)
    });

    let result = {};

    try {
      result = await response.json();
    } catch {
      // Response body may not be JSON.
    }

    if (!response.ok) {
      throw new Error(
        result.error || "Could not send location update."
      );
    }

    lastLocationSentAt = Date.now();

    setLiveLocationStatus(
      `Live sharing ON · Accuracy approximately ` +
      `${Math.round(coords.accuracy)} metres · ` +
      `Last update: ${new Date().toLocaleTimeString()}`
    );

  } catch (error) {
    setLiveLocationStatus(
      "Location update failed: " + error.message
    );

  } finally {
    liveLocationBusy = false;
  }
}

function startLiveLocation() {
  if (!$("consent").checked) {
    setLiveLocationStatus(
      "Please tick the consent checkbox first. " +
      "Location updates may be sent to the website operator's Telegram bot."
    );
    return;
  }

  if (!navigator.geolocation) {
    setLiveLocationStatus(
      "This browser does not support location."
    );
    return;
  }

  if (locationWatcher !== null) {
    setLiveLocationStatus(
      "Live location is already running. Press Stop to end sharing."
    );
    return;
  }

  $("startLiveLocationBtn").disabled = true;
  $("stopLiveLocationBtn").disabled = false;

  setLiveLocationStatus(
    "Requesting location permission. Choose Allow in your browser prompt."
  );

  locationWatcher = navigator.geolocation.watchPosition(
    (position) => {
      // If sharing was stopped while a callback was queued,
      // do not process that callback.
      if (locationWatcher === null) {
        return;
      }

      const coords = position.coords;
      const status = $("liveLocationStatus");

      if (status) {
        status.replaceChildren();

        const label = document.createElement("strong");
        label.textContent = "📍 Live location sharing is ON";

        const details = document.createElement("p");

        details.textContent =
          `Latitude: ${coords.latitude}\n` +
          `Longitude: ${coords.longitude}\n` +
          `Accuracy: approximately ${coords.accuracy.toFixed(1)} metres`;

        details.style.whiteSpace = "pre-line";

        const map = document.createElement("a");

        map.href =
          `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`;

        map.target = "_blank";
        map.rel = "noopener noreferrer";
        map.textContent = "Open current location in Google Maps";

        status.append(label, details, map);
      }

      void sendLiveLocation(position);
    },

    (error) => {
      const messages = {
        1: "Location permission denied. No live location is being sent.",
        2: "Location is currently unavailable.",
        3: "Location request timed out. Try again."
      };

      stopLiveLocation(
        messages[error.code] || "Unable to get location."
      );
    },

    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    }
  );
}

$("startLiveLocationBtn").addEventListener(
  "click",
  startLiveLocation
);

$("stopLiveLocationBtn").addEventListener(
  "click",
  () => stopLiveLocation()
);

// Immediately stop active sharing when consent is withdrawn.
$("consent").addEventListener("change", () => {
  if (!$("consent").checked && locationWatcher !== null) {
    stopLiveLocation(
      "Sharing stopped because consent was unchecked."
    );
  }
});

// Stop watching when the page is closed or navigated away from.
window.addEventListener("pagehide", () => {
  if (locationWatcher !== null) {
    navigator.geolocation.clearWatch(locationWatcher);
    locationWatcher = null;
  }
});

// ======================================
// OPTIONAL PHOTO UPLOAD
// ======================================

$("uploadBtn").addEventListener("click", async () => {
  const files = $("photos").files;
  const status = $("photoStatus");

  if (!files.length) {
    status.textContent =
      "Please select the photos you want to share.";
    return;
  }

  if (files.length > 5) {
    status.textContent =
      "Please select no more than 5 photos at once.";
    return;
  }

  if (!$("consent").checked) {
    status.textContent =
      "Please tick the consent checkbox before uploading.";
    return;
  }

  const form = new FormData();

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      status.textContent = "Only image files are accepted.";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      status.textContent =
        "Each image must be 5 MB or smaller.";
      return;
    }

    form.append("photos", file);
  }

  if (
    !confirm(
      "Upload the selected photos to the website operator?"
    )
  ) {
    return;
  }

  const button = $("uploadBtn");

  button.disabled = true;
  status.textContent = "Uploading selected photos...";

  try {
    const response = await fetch("/api/report", {
      method: "POST",
      body: form
    });

    let result = {};

    try {
      result = await response.json();
    } catch {
      // Response body may not be JSON.
    }

    if (!response.ok) {
      throw new Error(
        result.error || "Upload failed."
      );
    }

    status.textContent =
      "Selected photos uploaded successfully.";

    $("photos").value = "";

  } catch (error) {
    status.textContent = error.message;

  } finally {
    button.disabled = false;
  }
});