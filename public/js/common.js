/* ================================================
   Bus Reservation System - Shared JavaScript Library
   ================================================ */

// Safe DOM ready helper (fires immediately if DOM already parsed)
function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(fn, 1);
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}

// ---- API request helper ----
async function apiRequest(url, options = {}) {
    let response;
    try {
        response = await fetch(url, options);
    } catch (err) {
        throw new Error("Cannot connect to server. Please verify the backend is running.");
    }

    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
        const body = await response.text();
        console.error("Non-JSON response received:", body.slice(0, 300));
        throw new Error("Server returned an invalid non-JSON response.");
    }

    const result = await response.json();

    if (!response.ok) {
        const err = new Error(result.message || "Request failed.");
        err.status = response.status;
        err.data = result;
        throw err;
    }

    return result;
}

// ---- Toast Notification System ----
function showToast(message, type = "info", duration = 4000) {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: "✅",
        error: "❌",
        warning: "⚠️",
        info: "ℹ️"
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || "ℹ️"}</span>
        <span class="toast-text">${message}</span>
        <button class="toast-close" aria-label="Close">&times;</button>
    `;

    const closeBtn = toast.querySelector(".toast-close");
    closeBtn.addEventListener("click", () => {
        toast.classList.add("toast-hiding");
        setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add("toast-hiding");
            setTimeout(() => toast.remove(), 250);
        }
    }, duration);
}

// ---- Inline Message helpers ----
function showMsg(el, text, type = "info") {
    if (!el) return;
    el.textContent = text;
    el.className = "msg show msg-" + type;
}

function hideMsg(el) {
    if (!el) return;
    el.textContent = "";
    el.className = "msg";
}

// ---- Date / Time Formatters ----
function fmtDate(v) {
    if (!v) return "";
    return String(v).slice(0, 10);
}

function fmtTime(v) {
    if (!v) return "";
    var s = String(v);
    return s.slice(0, 5);
}

function fmtDateTime(v) {
    if (!v) return "-";
    var s = String(v).replace("T", " ");
    if (s.length >= 16) return s.slice(0, 16);
    return s;
}

// ---- Seat badge HTML ----
function seatBadge(avail) {
    var n = Number(avail);
    var cls = n <= 0 ? "badge-full" : (n <= 5 ? "badge-low" : "badge-available");
    var label = n <= 0 ? "FULL" : n + " seats left";
    return '<span class="badge ' + cls + '">' + label + '</span>';
}

// ---- Safe text node helper ----
function textCell(value) {
    var td = document.createElement("td");
    td.textContent = (value !== null && value !== undefined && value !== "") ? value : "-";
    return td;
}

// ---- Mobile hamburger toggle ----
onReady(function () {
    var btn = document.getElementById("hamburgerBtn");
    var links = document.getElementById("navLinks");
    if (btn && links) {
        btn.addEventListener("click", function () {
            links.classList.toggle("open");
        });
        links.querySelectorAll("a").forEach(function (a) {
            a.addEventListener("click", function () {
                links.classList.remove("open");
            });
        });
    }
});

// ---- Load dashboard stats ----
async function loadStats() {
    try {
        var data = await apiRequest("/api/stats");
        if (data.success) {
            var elBuses = document.getElementById("statBuses");
            var elSeats = document.getElementById("statSeats");
            var elBookings = document.getElementById("statBookings");
            var elCapacity = document.getElementById("statCapacity");

            if (elBuses) elBuses.textContent = data.total_buses;
            if (elSeats) elSeats.textContent = data.total_available_seats;
            if (elBookings) elBookings.textContent = data.total_reservations;
            if (elCapacity) elCapacity.textContent = data.total_capacity;
        }
    } catch (e) {
        console.warn("Could not load stats:", e.message);
    }
}
