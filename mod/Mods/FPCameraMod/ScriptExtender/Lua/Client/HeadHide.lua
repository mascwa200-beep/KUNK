--- HeadHide.lua -- experimental removal of the player's own head geometry.
---
--- Read this before enabling it. The reliable fix for seeing the inside of your
--- own skull in first person is on the native side: FPCamera.json pushes the
--- near clip plane forward and offsets the camera slightly ahead of the eye
--- point. That works on every build, costs nothing, and is on by default.
---
--- This file is the optional extra: asking the entity system to hide the head
--- visual outright, which looks better when it works. Whether it works at all
--- depends on your Script Extender version exposing writable visual components,
--- and the component layout has changed more than once. So every access is
--- probed, nothing is assumed, and a failure is reported once and then left
--- alone rather than retried every frame.
---
--- Off by default (headHide.enabled in the gameplay config).
local Compat = Ext.Require("Shared/Compat.lua")
local Config = Ext.Require("Shared/Config.lua")
local Log = Ext.Require("Shared/Log.lua")

local HeadHide = {}

local attempted = false
local succeeded = false

--- Slot names BG3 has used for head-adjacent visuals. Anything matching is
--- hidden; the hair and horns matter as much as the head itself, since they
--- are what actually intrudes into the near plane.
local HEAD_SLOTS = {
    Head = true,
    Hair = true,
    Horns = true,
    HeadDress = true,
    VanityHead = true,
}

local function clientCharacterEntity()
    -- Several routes, newest first.
    local ok, entity = Compat.Call("Ext.Entity.GetClientCharacter")
    if ok and entity ~= nil then return entity end

    ok, entity = Compat.Call("Ext.Client.GetCharacter")
    if ok and entity ~= nil then return entity end

    return nil
end

--- Walks the visual's slotted sub-objects and clears their visibility flag.
--- Returns the number of visuals it managed to touch.
local function hideHeadVisuals(entity)
    local hidden = 0

    local ok = pcall(function()
        local visual = entity.Visual and entity.Visual.Visual
        if visual == nil then return end

        local objects = visual.Objects or visual.SubObjects
        if objects == nil then return end

        for _, object in pairs(objects) do
            local slot = object.Slot or object.slot
            if slot ~= nil and HEAD_SLOTS[tostring(slot)] then
                -- Two spellings across versions; setting whichever exists.
                if object.Visible ~= nil then object.Visible = false end
                if object.IsVisible ~= nil then object.IsVisible = false end
                hidden = hidden + 1
            end
        end
    end)

    if not ok then return 0 end
    return hidden
end

function HeadHide.Apply()
    if not Config.current.headHide.enabled then return end
    if succeeded then return end
    if attempted then return end
    attempted = true

    local entity = clientCharacterEntity()
    if entity == nil then
        Log.Once("head:noentity", "Info",
            "Head hiding: the controlled character entity is not reachable "
            .. "from Lua on this build. The near-plane push in FPCamera.json "
            .. "is doing the work instead, which is the intended default.")
        return
    end

    local hidden = hideHeadVisuals(entity)
    if hidden > 0 then
        succeeded = true
        Log.Info("Head hiding: %d head-slot visual(s) hidden.", hidden)
    else
        Log.Once("head:novisuals", "Info",
            "Head hiding: no writable head-slot visuals were found, so nothing "
            .. "was changed. This is expected on most Script Extender versions; "
            .. "raise camera.nearPlane in FPCamera.json instead if you can "
            .. "still see your own head.")
    end
end

--- Re-attempt after a level load or a character switch, where the entity is
--- new and any previous change is gone.
function HeadHide.Reset()
    attempted = false
    succeeded = false
end

return HeadHide
