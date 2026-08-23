--- test_compat.lua -- the degrade-instead-of-crash guarantee.
---
--- This is the file the whole Lua half depends on. Every Osiris call and Ext
--- API the mod uses may be absent on the player's Script Extender version, and
--- the promise is that a missing one produces a single logged notice rather
--- than an error that takes the rest of the mod down. These tests remove the
--- APIs and check that promise holds.
local H = ...
local mock = dofile("tests/lua/mock_ext.lua")

local function fresh(options)
    mock.install(options)
    return Ext.Require("Shared/Compat.lua")
end

H.test("detects a present Osiris call", function()
    local Compat = fresh({ osi = { GetHostCharacter = function() return "hero" end } })
    H.check(Compat.HasOsi("GetHostCharacter"))
    local ok, value = Compat.CallOsi("GetHostCharacter")
    H.check(ok)
    H.equal(value, "hero")
end)

H.test("a missing Osiris call degrades instead of raising", function()
    local Compat = fresh({ osi = {} })
    H.check(not Compat.HasOsi("CharacterMoveToPosition"))
    local ok
    H.noError(function() ok = Compat.CallOsi("CharacterMoveToPosition", "a", 1, 2, 3) end)
    H.check(ok == false, "the call should report failure, not raise")
    H.contains(mock.log(), "CharacterMoveToPosition")
end)

H.test("an Osiris call that throws is contained", function()
    local Compat = fresh({ osi = { Boom = function() error("engine said no", 0) end } })
    local ok
    H.noError(function() ok = Compat.CallOsi("Boom") end)
    H.check(ok == false)
    H.contains(mock.log(), "engine said no")
end)

H.test("warns only once per missing call", function()
    local Compat = fresh({ osi = {} })
    for _ = 1, 50 do Compat.CallOsi("Missing") end
    local count = select(2, mock.log():gsub("Missing", ""))
    -- A per-tick warning would drown the console. One notice, then silence.
    H.equal(count, 1, "the notice should appear exactly once")
end)

H.test("resolves dotted Ext paths", function()
    local Compat = fresh({})
    H.check(Compat.Has("Ext.IO.LoadFile"))
    H.check(Compat.Has("Ext.Json.Parse"))
    H.check(not Compat.Has("Ext.Nonexistent.Thing"))
    H.check(not Compat.Has("Ext.IO.Nonexistent"))
    H.check(Compat.Resolve("Ext.Nonexistent.Deeply.Nested") == nil)
end)

H.test("a missing Ext API degrades instead of raising", function()
    local Compat = fresh({})
    mock.remove("Ext.Json.Parse")
    local ok
    H.noError(function() ok = Compat.Call("Ext.Json.Parse", "{}") end)
    H.check(ok == false)
    H.contains(mock.log(), "Ext.Json.Parse")
end)

H.test("an Ext API that throws is contained", function()
    local Compat = fresh({ ioLoadRaises = true })
    local ok
    H.noError(function() ok = Compat.Call("Ext.IO.LoadFile", "x") end)
    H.check(ok == false)
end)

H.test("the capability report runs on a stripped-down install", function()
    -- The report exists to tell the player which half of the mod is active.
    -- It must survive the very situation it is describing.
    local Compat = fresh({ osi = {} })
    mock.remove("Ext.Entity")
    mock.remove("Ext.Json")
    mock.remove("Ext.Events.KeyInput")
    H.noError(function() Compat.Report("server") end)
    H.noError(function() Compat.Report("client") end)
    H.contains(mock.log(), "MISSING")
end)

return H.run("Compat")
