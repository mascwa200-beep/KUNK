--- test_config.lua -- gameplay tunables and the override merge.
local H = ...
local mock = dofile("tests/lua/mock_ext.lua")

local function load(overrideText)
    mock.install()
    local Config = Ext.Require("Shared/Config.lua")
    if overrideText ~= nil then
        mock.state.files[Config.OVERRIDE_FILE] = overrideText
    end
    return Config, Config.Load()
end

H.test("uses built-in defaults when no override exists", function()
    local Config = load()
    H.near(Config.current.interaction.range, 4.0, 1e-9)
    H.near(Config.current.targeting.coneDegrees, 12.0, 1e-9)
    H.equal(Config.current.interaction.enabled, true)
    H.equal(Config.current.headHide.enabled, false)
    H.contains(mock.log(), "built-in gameplay defaults")
end)

H.test("merges an override without discarding the rest", function()
    -- A partial override must change only what it names. Replacing whole
    -- subtables would silently drop the fields the user did not mention.
    local Config = load('{"interaction":{"range":8.5}}')
    H.near(Config.current.interaction.range, 8.5, 1e-9)
    H.near(Config.current.interaction.coneDegrees, 25.0, 1e-9)
    H.near(Config.current.targeting.range, 30.0, 1e-9)
    H.equal(Config.current.interaction.enabled, true)
end)

H.test("merges nested tables deeply", function()
    local Config = load('{"interaction":{"range":2},"targeting":{"coneDegrees":45}}')
    H.near(Config.current.interaction.range, 2, 1e-9)
    H.near(Config.current.targeting.coneDegrees, 45, 1e-9)
    H.near(Config.current.targeting.range, 30.0, 1e-9)
end)

H.test("a malformed override falls back to defaults and says so", function()
    local Config = load('{ this is not json')
    H.near(Config.current.interaction.range, 4.0, 1e-9)
    H.contains(mock.log(), "could not be parsed")
end)

H.test("an empty override file is treated as absent", function()
    local Config = load('')
    H.near(Config.current.interaction.range, 4.0, 1e-9)
end)

H.test("reloading resets values the previous load changed", function()
    -- Otherwise an override removed from the file would linger until restart.
    mock.install()
    local Config = Ext.Require("Shared/Config.lua")
    mock.state.files[Config.OVERRIDE_FILE] = '{"interaction":{"range":9}}'
    Config.Load()
    H.near(Config.current.interaction.range, 9, 1e-9)

    mock.state.files[Config.OVERRIDE_FILE] = nil
    Config.Load()
    H.near(Config.current.interaction.range, 4.0, 1e-9)
end)

H.test("the log level follows the config", function()
    local Config = load('{"logLevel":"error"}')
    local Log = Ext.Require("Shared/Log.lua")
    H.equal(Log.level, "error")
    -- An info message must now be suppressed.
    local before = #mock.state.printed
    Log.Info("this should not appear")
    H.equal(#mock.state.printed, before)
    Log.Error("this should appear")
    H.equal(#mock.state.printed, before + 1)
end)

H.test("survives Ext.IO being unavailable entirely", function()
    mock.install()
    local Config = Ext.Require("Shared/Config.lua")
    mock.remove("Ext.IO")
    H.noError(function() Config.Load() end)
    H.near(Config.current.interaction.range, 4.0, 1e-9)
end)

return H.run("Config")
