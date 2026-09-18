#include "InputHook.h"

#include "CameraHook.h"
#include "Config.h"
#include "D3D11Hook.h"
#include "Logger.h"

#include <atomic>

namespace fpcam::input {
namespace {

HWND g_window = nullptr;
WNDPROC g_originalWndProc = nullptr;
bool g_rawInputRegistered = false;

std::atomic<bool> g_cursorLockEnabled{true};
std::atomic<bool> g_uiOpen{false};
std::atomic<bool> g_windowFocused{true};

// Mouse look and the cursor pin are related but not the same condition.
// Looking around should keep working for someone who turned the cursor lock off
// in the config; what must stop, in both cases, is looking around while a menu
// or a dialogue has the player's attention.
bool ShouldLookNow() {
    if (!camera::FirstPersonEnabled()) return false;
    if (!g_windowFocused.load()) return false;
    if (GetConfig().mouse.autoReleaseOnUI && g_uiOpen.load()) return false;
    return true;
}

bool ShouldLockNow() {
    if (!g_cursorLockEnabled.load()) return false;
    return ShouldLookNow();
}

bool WindowCentre(POINT* out) {
    if (g_window == nullptr) return false;
    RECT client = {};
    if (!::GetClientRect(g_window, &client)) return false;
    POINT centre = {(client.right - client.left) / 2,
                    (client.bottom - client.top) / 2};
    if (!::ClientToScreen(g_window, &centre)) return false;
    *out = centre;
    return true;
}

void ConfineCursor() {
    RECT client = {};
    if (!::GetClientRect(g_window, &client)) return;

    POINT topLeft = {client.left, client.top};
    POINT bottomRight = {client.right, client.bottom};
    if (!::ClientToScreen(g_window, &topLeft)) return;
    if (!::ClientToScreen(g_window, &bottomRight)) return;

    const RECT screenRect = {topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
    ::ClipCursor(&screenRect);
}

void CentreCursor() {
    POINT centre = {};
    if (!WindowCentre(&centre)) return;

    POINT current = {};
    if (::GetCursorPos(&current) && current.x == centre.x &&
        current.y == centre.y) {
        return;  // already centred; avoid a pointless WM_MOUSEMOVE
    }

    // The WM_MOUSEMOVE this generates is swallowed in HookedWndProc while the
    // lock is active, so the game never sees the teleport.
    ::SetCursorPos(centre.x, centre.y);
}

void HandleRawInput(LPARAM lParam) {
    UINT size = 0;
    if (::GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT,
                          nullptr, &size, sizeof(RAWINPUTHEADER)) != 0) {
        return;
    }
    if (size == 0 || size > sizeof(RAWINPUT) * 4) return;

    // RAWINPUT for a mouse is small and fixed-size; a stack buffer keeps this
    // allocation-free on a path that runs hundreds of times per second.
    alignas(8) uint8_t buffer[sizeof(RAWINPUT) * 4];
    if (::GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT, buffer,
                          &size, sizeof(RAWINPUTHEADER)) != size) {
        return;
    }

    const auto* raw = reinterpret_cast<const RAWINPUT*>(buffer);
    if (raw->header.dwType != RIM_TYPEMOUSE) return;

    // Absolute-mode devices (tablets, some remote-desktop sessions) report a
    // position rather than a delta; converting that here would need the last
    // absolute position and is not worth the complexity for a mod. Skip them
    // and let the player use MOUSE_MOVE_RELATIVE hardware.
    if ((raw->data.mouse.usFlags & MOUSE_MOVE_ABSOLUTE) != 0) return;

    const LONG deltaX = raw->data.mouse.lLastX;
    const LONG deltaY = raw->data.mouse.lLastY;
    if (deltaX == 0 && deltaY == 0) return;

    if (!ShouldLookNow()) return;

    camera::ApplyMouseDelta(static_cast<float>(deltaX),
                            static_cast<float>(deltaY));
}

LRESULT CALLBACK HookedWndProc(HWND window, UINT message, WPARAM wParam,
                               LPARAM lParam) {
    switch (message) {
        case WM_INPUT:
            HandleRawInput(lParam);
            break;

        case WM_MOUSEMOVE:
        case WM_NCMOUSEMOVE:
            // While locked we teleport the cursor back to the centre every
            // frame. Letting those synthetic moves reach the game would look
            // like violent cursor jitter to its own input handling, so they are
            // swallowed and the game keeps seeing a cursor parked at the
            // centre -- which is exactly what makes its picking ray a reticle.
            if (ShouldLockNow() && GetConfig().mouse.suppressGameCameraRotate) {
                return 0;
            }
            break;

        case WM_ACTIVATE:
            g_windowFocused.store(LOWORD(wParam) != WA_INACTIVE);
            if (!g_windowFocused.load()) {
                ::ClipCursor(nullptr);
            }
            break;

        case WM_KILLFOCUS:
            // Alt-tabbing out with the cursor confined would trap the pointer
            // inside a window that no longer has focus.
            g_windowFocused.store(false);
            ::ClipCursor(nullptr);
            break;

        case WM_SETFOCUS:
            g_windowFocused.store(true);
            break;

        default:
            break;
    }

    return ::CallWindowProcW(g_originalWndProc, window, message, wParam, lParam);
}

bool RegisterForRawMouse(HWND window) {
    RAWINPUTDEVICE device = {};
    device.usUsagePage = 0x01;  // generic desktop controls
    device.usUsage = 0x02;      // mouse
    device.dwFlags = 0;         // deliver only while this window has focus
    device.hwndTarget = window;

    if (!::RegisterRawInputDevices(&device, 1, sizeof(device))) {
        FPCAM_ERROR("RegisterRawInputDevices failed: {}. Mouse look is "
                    "unavailable.", ::GetLastError());
        return false;
    }
    return true;
}

bool AttachTo(HWND window) {
    if (window == nullptr || g_originalWndProc != nullptr) return false;

    g_originalWndProc = reinterpret_cast<WNDPROC>(::SetWindowLongPtrW(
        window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&HookedWndProc)));
    if (g_originalWndProc == nullptr) {
        FPCAM_ERROR("SetWindowLongPtrW failed: {}. Mouse look is unavailable.",
                    ::GetLastError());
        return false;
    }

    g_window = window;
    g_rawInputRegistered = RegisterForRawMouse(window);

    FPCAM_INFO("Input hook attached to window {} (raw input: {}).",
               static_cast<void*>(window),
               g_rawInputRegistered ? "registered" : "FAILED");
    return true;
}

}  // namespace

bool Install() {
    // The swapchain gives us the game's real window, but only once it has
    // presented. Before that we simply wait; OnFrame retries.
    HWND window = d3d11::Window();
    if (window == nullptr) {
        FPCAM_DEBUG("Input hook deferred: the game window is not known yet.");
        return false;
    }
    return AttachTo(window);
}

void Uninstall() {
    if (g_window != nullptr && g_originalWndProc != nullptr) {
        ::SetWindowLongPtrW(g_window, GWLP_WNDPROC,
                            reinterpret_cast<LONG_PTR>(g_originalWndProc));
    }
    if (g_rawInputRegistered) {
        RAWINPUTDEVICE device = {};
        device.usUsagePage = 0x01;
        device.usUsage = 0x02;
        device.dwFlags = RIDEV_REMOVE;
        device.hwndTarget = nullptr;
        ::RegisterRawInputDevices(&device, 1, sizeof(device));
        g_rawInputRegistered = false;
    }
    ::ClipCursor(nullptr);
    g_originalWndProc = nullptr;
    g_window = nullptr;
    FPCAM_INFO("Input hook detached.");
}

void OnFrame() {
    if (g_originalWndProc == nullptr) {
        HWND window = d3d11::Window();
        if (window != nullptr) AttachTo(window);
        return;
    }

    static bool wasLocked = false;
    const bool locked = ShouldLockNow();

    if (locked) {
        ConfineCursor();
        CentreCursor();
    } else if (wasLocked) {
        ::ClipCursor(nullptr);
    }
    wasLocked = locked;
}

void SetCursorLockEnabled(bool enabled) {
    if (g_cursorLockEnabled.exchange(enabled) == enabled) return;
    FPCAM_INFO("Cursor lock {}.", enabled ? "enabled" : "released");
    if (!enabled) ::ClipCursor(nullptr);
}

bool CursorLockEnabled() { return g_cursorLockEnabled.load(); }

void SetUIOpen(bool open) {
    if (g_uiOpen.exchange(open) == open) return;
    FPCAM_DEBUG("UI state changed: {}", open ? "open" : "closed");
    if (open) ::ClipCursor(nullptr);
}

bool UIOpen() { return g_uiOpen.load(); }

bool CursorCurrentlyLocked() { return ShouldLockNow(); }

}  // namespace fpcam::input
