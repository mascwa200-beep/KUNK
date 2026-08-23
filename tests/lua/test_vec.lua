--- test_vec.lua -- the vector helpers the movement and targeting code build on.
local H = ...
local mock = dofile("tests/lua/mock_ext.lua")
mock.install()
local Vec = Ext.Require("Shared/Vec.lua")

H.test("constructs and defaults to zero", function()
    local v = Vec.new(1, 2, 3)
    H.equal(v.x, 1); H.equal(v.y, 2); H.equal(v.z, 3)
    local zero = Vec.new()
    H.equal(zero.x, 0); H.equal(zero.y, 0); H.equal(zero.z, 0)
end)

H.test("accepts both shapes positions arrive in", function()
    -- Osiris returns three loose numbers; entity components return an array.
    -- Both have to work or half the call sites break.
    local loose = Vec.from(1, 2, 3)
    H.equal(loose.x, 1); H.equal(loose.z, 3)

    local array = Vec.from({ 4, 5, 6 })
    H.equal(array.x, 4); H.equal(array.z, 6)

    local named = Vec.from({ x = 7, y = 8, z = 9 })
    H.equal(named.x, 7); H.equal(named.z, 9)
end)

H.test("arithmetic", function()
    local sum = Vec.add(Vec.new(1, 2, 3), Vec.new(10, 20, 30))
    H.equal(sum.x, 11); H.equal(sum.z, 33)

    local difference = Vec.sub(Vec.new(10, 10, 10), Vec.new(1, 2, 3))
    H.equal(difference.x, 9); H.equal(difference.z, 7)

    local scaled = Vec.scale(Vec.new(1, 2, 3), 3)
    H.equal(scaled.y, 6)

    H.equal(Vec.dot(Vec.new(1, 0, 0), Vec.new(0, 1, 0)), 0)
    H.equal(Vec.dot(Vec.new(2, 0, 0), Vec.new(3, 0, 0)), 6)
    H.near(Vec.length(Vec.new(3, 4, 0)), 5, 1e-9)
end)

H.test("horizontal distance ignores height", function()
    -- Interaction range must not care that a barrel is on a table.
    local a = Vec.new(0, 0, 0)
    local b = Vec.new(3, 100, 4)
    H.near(Vec.horizontalDistance(a, b), 5, 1e-9)
end)

H.test("normalize handles the degenerate case", function()
    local unit = Vec.normalize(Vec.new(0, 0, 5))
    H.near(unit.z, 1, 1e-9)
    -- A zero vector must not produce NaN, which would poison a move order.
    local zero = Vec.normalize(Vec.new(0, 0, 0))
    H.equal(zero.x, 0); H.equal(zero.y, 0); H.equal(zero.z, 0)
end)

H.test("flatten drops height and renormalises", function()
    local flat = Vec.flatten(Vec.new(3, 999, 4))
    H.equal(flat.y, 0)
    H.near(Vec.length(flat), 1, 1e-9)
    H.near(flat.x, 0.6, 1e-9)

    -- Looking straight up has no horizontal component. The result must be zero
    -- rather than NaN, because it feeds straight into a movement direction.
    local vertical = Vec.flatten(Vec.new(0, 1, 0))
    H.equal(vertical.x, 0); H.equal(vertical.z, 0)
    H.check(vertical.x == vertical.x, "must not be NaN")
end)

return H.run("Vec")
