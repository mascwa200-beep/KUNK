--- test_bridge.lua -- the file exchange with the DLL.
---
--- Exercised end to end: the payload is really serialised, really written to
--- the mock filesystem, really read back and really parsed. Passing tables
--- around would not catch a serialisation mistake, and that is the failure that
--- would silently disconnect the two halves of the mod.
local H = ...
local mock = dofile("tests/lua/mock_ext.lua")

local function fresh()
    mock.install()
    return Ext.Require("Shared/Bridge.lua")
end

H.test("returns nil and explains when the DLL is not publishing", function()
    local Bridge = fresh()
    H.equal(Bridge.ReadNative(), nil)
    H.contains(mock.log(), "FPCamera.dll is not loaded")
end)

H.test("reads what the DLL publishes", function()
    local Bridge = fresh()
    mock.state.files[Bridge.NATIVE_FILE] = mock.json.encode({
        firstPerson = true, yaw = 42.5, movementMode = "moveto",
        forward = { 0, 0, 1 }, moveIntent = { 0.5, 1.0 },
    })
    local native = Bridge.ReadNative()
    H.check(native ~= nil, "should have decoded a payload")
    H.equal(native.firstPerson, true)
    H.near(native.yaw, 42.5, 1e-9)
    H.equal(native.movementMode, "moveto")
    H.near(native.forward[3], 1, 1e-9)
    H.near(native.moveIntent[1], 0.5, 1e-9)
end)

H.test("a torn read is ignored rather than propagated", function()
    -- The DLL rewrites the file several times a second; reading mid-write is
    -- normal. It must yield nil, not an error, and not a half-populated table.
    local Bridge = fresh()
    mock.state.files[Bridge.NATIVE_FILE] = '{"firstPerson": tr'
    local native
    H.noError(function() native = Bridge.ReadNative() end)
    H.equal(native, nil)
end)

H.test("publishes to the file the DLL reads", function()
    local Bridge = fresh()
    H.check(Bridge.Publish("server", { inCombat = true, race = "Dwarf" }))
    local written = mock.state.files[Bridge.SERVER_FILE]
    H.check(written ~= nil, "the server file should exist")
    local decoded = mock.json.decode(written)
    H.equal(decoded.inCombat, true)
    H.equal(decoded.race, "Dwarf")
end)

H.test("server and client write to separate files", function()
    -- One file with two writers would race. Each context owns its own.
    local Bridge = fresh()
    Bridge.Publish("server", { race = "Elf" })
    Bridge.Publish("client", { uiOpen = true })
    H.check(mock.state.files[Bridge.SERVER_FILE] ~= nil)
    H.check(mock.state.files[Bridge.CLIENT_FILE] ~= nil)
    H.check(Bridge.SERVER_FILE ~= Bridge.CLIENT_FILE)
    H.equal(mock.json.decode(mock.state.files[Bridge.CLIENT_FILE]).uiOpen, true)
    H.equal(mock.json.decode(mock.state.files[Bridge.SERVER_FILE]).race, "Elf")
end)

H.test("the sequence number advances so a stale file is detectable", function()
    local Bridge = fresh()
    Bridge.Publish("server", {})
    local first = mock.json.decode(mock.state.files[Bridge.SERVER_FILE]).sequence
    Bridge.Publish("server", {})
    local second = mock.json.decode(mock.state.files[Bridge.SERVER_FILE]).sequence
    H.check(second > first, "sequence must increase")
end)

H.test("a full round trip preserves the payload", function()
    local Bridge = fresh()
    local payload = {
        uiOpen = false, inDialog = true, race = "Githyanki",
        position = { 1.5, -2.25, 300.0 },
    }
    Bridge.Publish("server", payload)
    local decoded = mock.json.decode(mock.state.files[Bridge.SERVER_FILE])
    H.equal(decoded.uiOpen, false)
    H.equal(decoded.inDialog, true)
    H.equal(decoded.race, "Githyanki")
    H.near(decoded.position[2], -2.25, 1e-9)
    H.near(decoded.position[3], 300.0, 1e-9)
end)

H.test("survives Ext.IO write failures", function()
    mock.install({ ioSaveRaises = true })
    local Bridge = Ext.Require("Shared/Bridge.lua")
    local result
    H.noError(function() result = Bridge.Publish("server", { race = "Human" }) end)
    H.check(result == false or result == nil)
end)

H.test("survives Ext.Json being unavailable", function()
    mock.install()
    local Bridge = Ext.Require("Shared/Bridge.lua")
    mock.state.files[Bridge.NATIVE_FILE] = '{"firstPerson":true}'
    mock.remove("Ext.Json")
    H.noError(function() Bridge.ReadNative() end)
    H.noError(function() Bridge.Publish("server", {}) end)
end)

return H.run("Bridge")
