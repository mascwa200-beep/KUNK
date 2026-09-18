--- mock_ext.lua -- a stand-in for Script Extender.
---
--- The mod's whole compatibility strategy is that a missing Ext or Osi entry
--- point degrades to a logged notice instead of a Lua error. That is only worth
--- claiming if it is exercised, so this mock is built to be *taken apart*:
--- every API can be removed, or made to raise, and the tests assert the mod
--- carries on.
---
--- It also gives Ext.IO a real in-memory filesystem and Ext.Json a real
--- encoder, so the bridge is tested by actually serialising, writing, reading
--- and parsing rather than by passing tables around.
local json = dofile("tests/lua/json.lua")

local M = {}

M.LUA_ROOT = "mod/Mods/FPCameraMod/ScriptExtender/Lua/"

--- Rebuilds a pristine Ext/Osi pair in the globals. Called before every test so
--- no state leaks between them.
function M.install(options)
    options = options or {}

    local state = {
        printed = {},          -- everything the mod logged
        files = {},            -- the in-memory Ext.IO filesystem
        consoleCommands = {},
        netListeners = {},
        netMessages = {},
        osirisListeners = {},
        subscribers = {},      -- event name -> list of handlers
        entities = {},         -- component name -> list of entities
        requireCache = {},
    }
    M.state = state

    local function record(level)
        return function(message)
            table.insert(state.printed, { level = level, text = tostring(message) })
        end
    end

    local function event(name)
        state.subscribers[name] = {}
        return {
            Subscribe = function(_, handler)
                table.insert(state.subscribers[name], handler)
            end,
        }
    end

    local Ext = {}

    -- Ext.Require resolves against the real mod tree, so the tests load the
    -- shipped files rather than copies.
    Ext.Require = function(path)
        if state.requireCache[path] ~= nil then return state.requireCache[path] end
        local chunk, err = loadfile(M.LUA_ROOT .. path)
        if not chunk then error("mock Ext.Require failed for " .. path .. ": " ..
            tostring(err), 0) end
        local value = chunk()
        state.requireCache[path] = value
        return value
    end

    Ext.Utils = {
        Print = record("info"),
        PrintWarning = record("warn"),
        PrintError = record("error"),
        GetGameState = function() return options.gameState end,
    }

    Ext.IO = {
        LoadFile = function(name, _context)
            if options.ioLoadRaises then error("Ext.IO.LoadFile exploded", 0) end
            return state.files[name]
        end,
        SaveFile = function(name, contents, _context)
            if options.ioSaveRaises then error("Ext.IO.SaveFile exploded", 0) end
            state.files[name] = contents
            return true
        end,
    }

    Ext.Json = {
        Parse = function(text) return json.decode(text) end,
        Stringify = function(value) return json.encode(value) end,
    }

    Ext.Events = {
        Tick = event("Tick"),
        SessionLoaded = event("SessionLoaded"),
        GameStateChanged = event("GameStateChanged"),
    }
    if options.withKeyInput then
        Ext.Events.KeyInput = event("KeyInput")
    end

    Ext.Entity = {
        Get = function(id) return state.entities[id] end,
        GetAllEntitiesWithComponent = function(component)
            if options.entityQueryRaises then error("no such component", 0) end
            return state.entities[component]
        end,
    }

    Ext.Net = {
        PostMessageToServer = function(channel, payload)
            table.insert(state.netMessages, { channel = channel, payload = payload })
        end,
    }

    Ext.Osiris = {
        RegisterListener = function(name, arity, when, handler)
            if options.osirisRegisterRaises then error("cannot subscribe", 0) end
            table.insert(state.osirisListeners,
                { name = name, arity = arity, when = when, handler = handler })
        end,
    }

    Ext.RegisterConsoleCommand = function(name, handler)
        state.consoleCommands[name] = handler
    end

    Ext.RegisterNetListener = function(channel, handler)
        state.netListeners[channel] = handler
    end

    Ext.Client = { GetGameState = function() return options.gameState end }
    Ext.UI = options.uiRoot and { GetRoot = function() return options.uiRoot end } or nil

    Ext.IsServer = function() return options.context ~= "client" end
    Ext.IsClient = function() return options.context == "client" end

    _G.Ext = Ext
    _G.Osi = options.osi or {}

    return state
end

--- Removes a dotted path from the globals, so a test can prove the mod copes
--- with that API being absent on an older Script Extender.
function M.remove(path)
    local parts = {}
    for part in path:gmatch("[^%.]+") do table.insert(parts, part) end
    local current = _G
    for i = 1, #parts - 1 do
        current = current[parts[i]]
        if current == nil then return end
    end
    current[parts[#parts]] = nil
end

--- Every log line the mod produced, joined, for substring assertions.
function M.log()
    local parts = {}
    for _, entry in ipairs(M.state.printed) do
        table.insert(parts, entry.level .. ": " .. entry.text)
    end
    return table.concat(parts, "\n")
end

--- Fires a subscribed event.
function M.fire(name, payload)
    for _, handler in ipairs(M.state.subscribers[name] or {}) do
        handler(payload)
    end
end

--- A tick payload shaped like Script Extender's.
function M.tick(deltaTime)
    return { Time = { DeltaTime = deltaTime or (1.0 / 60.0) } }
end

--- Builds an entity the Targeting cone query can consume.
function M.entity(uuid, x, y, z)
    return {
        Uuid = { EntityUuid = uuid },
        Transform = { Transform = { Translate = { x, y, z } } },
    }
end

M.json = json
return M
