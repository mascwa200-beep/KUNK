--- Bridge.lua -- the Lua end of the file exchange with FPCamera.dll.
---
--- Script Extender's Lua has no FFI and no shared memory, so this is the only
--- channel available. Ext.IO reads and writes inside
---   %LOCALAPPDATA%\Larian Studios\Baldur's Gate 3\Script Extender\
--- which is exactly where the native side puts its files.
---
--- Three files, each with a single writer, so nothing races:
---   fpcamera_native.json  written by the DLL, read here (camera heading, mode)
---   fpcamera_lua.json     written by the server context (character, combat)
---   fpcamera_ui.json      written by the client context (panels, dialogue)
local Compat = Ext.Require("Shared/Compat.lua")
local Log = Ext.Require("Shared/Log.lua")

local Bridge = {}

Bridge.NATIVE_FILE = "fpcamera_native.json"
Bridge.SERVER_FILE = "fpcamera_lua.json"
Bridge.CLIENT_FILE = "fpcamera_ui.json"

local sequence = 0

--- Older Script Extender builds take Ext.IO.LoadFile(path); newer ones accept a
--- context argument. Try the explicit form first and fall back.
local function loadFile(name)
    local ok, contents = Compat.Call("Ext.IO.LoadFile", name, "user")
    if ok and contents ~= nil then return contents end
    ok, contents = Compat.Call("Ext.IO.LoadFile", name)
    if ok then return contents end
    return nil
end

local function saveFile(name, contents)
    local ok = Compat.Call("Ext.IO.SaveFile", name, contents, "user")
    if ok then return true end
    return Compat.Call("Ext.IO.SaveFile", name, contents) and true or false
end

--- Most recent state published by the DLL, or nil if it is not running.
--- Returns a table with: firstPerson, cursorLocked, yaw, pitch, forward,
--- right, movementMode, moveToDistance, moveToRateHz.
function Bridge.ReadNative()
    local contents = loadFile(Bridge.NATIVE_FILE)
    if contents == nil or contents == "" then
        Log.Once("bridge:missing", "Info",
            "No %s yet. Either FPCamera.dll is not loaded, or the game was "
            .. "launched in Vulkan mode. The gameplay tweaks that do not need "
            .. "the camera will still run.", Bridge.NATIVE_FILE)
        return nil
    end

    local ok, decoded = Compat.Call("Ext.Json.Parse", contents)
    if not ok or type(decoded) ~= "table" then
        -- A torn read while the DLL rewrites the file. Next tick will get it.
        return nil
    end
    return decoded
end

--- Publishes this context's state. `which` is "server" or "client".
function Bridge.Publish(which, payload)
    sequence = sequence + 1
    payload.sequence = sequence

    local ok, encoded = Compat.Call("Ext.Json.Stringify", payload)
    if not ok or type(encoded) ~= "string" then return false end

    local name = (which == "client") and Bridge.CLIENT_FILE or Bridge.SERVER_FILE
    return saveFile(name, encoded)
end

return Bridge
