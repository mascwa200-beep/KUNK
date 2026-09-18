--- Vec.lua -- the handful of 3-vector operations this mod needs.
---
--- Baldur's Gate 3 uses a Y-up world, so "horizontal" here means the XZ plane.
local Vec = {}

function Vec.new(x, y, z)
    return { x = x or 0.0, y = y or 0.0, z = z or 0.0 }
end

--- Osiris position getters return three loose numbers; entity components return
--- an array. Accepts either.
function Vec.from(a, b, c)
    if type(a) == "table" then
        return Vec.new(a[1] or a.x, a[2] or a.y, a[3] or a.z)
    end
    return Vec.new(a, b, c)
end

function Vec.add(a, b)
    return Vec.new(a.x + b.x, a.y + b.y, a.z + b.z)
end

function Vec.sub(a, b)
    return Vec.new(a.x - b.x, a.y - b.y, a.z - b.z)
end

function Vec.scale(v, s)
    return Vec.new(v.x * s, v.y * s, v.z * s)
end

function Vec.dot(a, b)
    return a.x * b.x + a.y * b.y + a.z * b.z
end

function Vec.length(v)
    return math.sqrt(Vec.dot(v, v))
end

--- Distance ignoring height. Interaction range should not care that a barrel is
--- on a table and the player is not.
function Vec.horizontalDistance(a, b)
    local dx, dz = a.x - b.x, a.z - b.z
    return math.sqrt(dx * dx + dz * dz)
end

function Vec.normalize(v)
    local length = Vec.length(v)
    if length < 1e-6 then return Vec.new(0, 0, 0) end
    return Vec.scale(v, 1.0 / length)
end

--- Drops the vertical component and re-normalises. Used for movement, where
--- looking at the sky must not make the character try to walk upwards.
function Vec.flatten(v)
    return Vec.normalize(Vec.new(v.x, 0.0, v.z))
end

function Vec.tostring(v)
    return string.format("(%.2f, %.2f, %.2f)", v.x, v.y, v.z)
end

return Vec
