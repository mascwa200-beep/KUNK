--- run.lua -- the Lua test runner.
---
--- Run from the repository root:  lua5.4 tests/lua/run.lua
local H = dofile("tests/lua/harness.lua")

local suites = {
    "test_vec", "test_config", "test_compat", "test_bridge",
    "test_targeting", "test_movement",
}

local failedSuites = 0
for _, name in ipairs(suites) do
    local chunk, err = loadfile("tests/lua/" .. name .. ".lua")
    if not chunk then
        print("FAILED TO LOAD " .. name .. ": " .. tostring(err))
        failedSuites = failedSuites + 1
    else
        local ok, runErr = pcall(chunk, H)
        if not ok then
            print("SUITE RAISED " .. name .. ": " .. tostring(runErr))
            failedSuites = failedSuites + 1
        end
    end
    print("")
end

print("----------------------------------------")
print(string.format("%d assertion(s), %d failure(s)", H.checks, #H.failures))
if #H.failures == 0 and failedSuites == 0 then
    print("PASS")
    os.exit(0)
end
print("FAIL")
os.exit(1)
