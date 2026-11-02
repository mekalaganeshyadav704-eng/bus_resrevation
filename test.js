// test.js - Automated Verification Suite for Bus Reservation System
const http = require("http");
const { app, db } = require("./server");

const TEST_PORT = 3001;
let server;
let createdTestBusId = null;
let createdTestResId = null;

function request(options, postData) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                let json = null;
                try {
                    json = JSON.parse(data);
                } catch (e) {
                    // Not JSON
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data,
                    json: json
                });
            });
        });

        req.on("error", reject);

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

async function runTests() {
    console.log("==================================================");
    console.log("RUNNING BUS RESERVATION SYSTEM VERIFICATION SUITE");
    console.log("==================================================\n");

    let passedTests = 0;
    let failedTests = 0;

    function assert(condition, testName, details = "") {
        if (condition) {
            console.log(`[PASS] ${testName}`);
            passedTests++;
        } else {
            console.error(`[FAIL] ${testName} - ${details}`);
            failedTests++;
        }
    }

    try {
        // Start test server
        await new Promise((resolve) => {
            server = app.listen(TEST_PORT, () => {
                console.log(`Test server running on port ${TEST_PORT}\n`);
                resolve();
            });
        });

        // TEST 1: Server startup & MySQL Connection
        console.log("--- TEST 1: Server startup & Database Pool ---");
        await new Promise((resolve, reject) => {
            db.getConnection((err, conn) => {
                assert(!err, "TEST 1: MySQL connects successfully", err ? err.message : "");
                if (conn) conn.release();
                resolve();
            });
        });

        // TEST 2: View buses (GET /api/buses)
        console.log("\n--- TEST 2: View buses (GET /api/buses) ---");
        const res2 = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: "/api/buses",
            method: "GET"
        });
        assert(res2.statusCode === 200, "TEST 2.1: Status is 200 OK");
        assert(Array.isArray(res2.json), "TEST 2.2: Response is JSON Array");
        assert(res2.json.length > 0, "TEST 2.3: Existing buses are returned", `Count: ${res2.json.length}`);
        const firstBus = res2.json[0];
        assert(
            firstBus && "bus_id" in firstBus && "available_seats" in firstBus && "total_seats" in firstBus,
            "TEST 2.4: Bus object includes bus_id, total_seats, and calculated available_seats"
        );
        // Verify date format is string 'YYYY-MM-DD' (not UTC shifted ISO)
        assert(
            typeof firstBus.departure_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(firstBus.departure_date),
            "TEST 2.5: Departure date is exact YYYY-MM-DD string without timezone drift",
            `Received: ${firstBus.departure_date}`
        );

        // TEST 3: Add bus (POST /api/buses)
        console.log("\n--- TEST 3: Add bus (POST /api/buses) ---");
        const newBusData = {
            service_no: "TEST-999",
            source: "Testville",
            destination: "Samplopolis",
            departure_date: "2026-11-15",
            departure_time: "15:30",
            total_seats: 30
        };
        const res3 = await request(
            {
                hostname: "localhost",
                port: TEST_PORT,
                path: "/api/buses",
                method: "POST",
                headers: { "Content-Type": "application/json" }
            },
            JSON.stringify(newBusData)
        );
        assert(res3.statusCode === 201, "TEST 3.1: Add bus returns 201 Created");
        assert(res3.json && res3.json.success === true, "TEST 3.2: Success flag is true");
        assert(res3.json && res3.json.bus_id > 0, "TEST 3.3: Returns auto-generated bus_id");
        createdTestBusId = res3.json ? res3.json.bus_id : null;

        // Verify persistence of newly added bus
        const res3b = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: `/api/buses/${createdTestBusId}`,
            method: "GET"
        });
        assert(res3b.statusCode === 200, "TEST 3.4: Newly added bus persists and can be retrieved by ID");
        assert(
            res3b.json && res3b.json.bus && res3b.json.bus.service_no === "TEST-999",
            "TEST 3.5: Retrieved bus service_no matches"
        );

        // TEST 4: Invalid bus validation
        console.log("\n--- TEST 4: Invalid bus data rejection ---");
        const res4a = await request(
            {
                hostname: "localhost",
                port: TEST_PORT,
                path: "/api/buses",
                method: "POST",
                headers: { "Content-Type": "application/json" }
            },
            JSON.stringify({
                service_no: "",
                source: "",
                destination: "",
                departure_date: "invalid-date",
                departure_time: "",
                total_seats: 0
            })
        );
        assert(res4a.statusCode === 400, "TEST 4.1: Empty fields and 0 seats rejected with 400 Bad Request");
        assert(res4a.json && res4a.json.success === false, "TEST 4.2: Response contains error message");

        // TEST 5: Search buses
        console.log("\n--- TEST 5: Search buses (GET /api/search) ---");
        // Search matching
        const res5a = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: "/api/search?source=testville&destination=samplopolis&date=2026-11-15",
            method: "GET"
        });
        assert(res5a.statusCode === 200, "TEST 5.1: Search returns 200 OK");
        assert(Array.isArray(res5a.json) && res5a.json.length === 1, "TEST 5.2: Search found exact match case-insensitively");
        assert(
            res5a.json[0] && res5a.json[0].bus_id === createdTestBusId,
            "TEST 5.3: Match corresponds to the created test bus"
        );

        // Search non-existent
        const res5b = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: "/api/search?source=Nowhere&destination=Moon&date=2026-11-15",
            method: "GET"
        });
        assert(res5b.statusCode === 200, "TEST 5.4: Non-existent search returns 200 OK");
        assert(Array.isArray(res5b.json) && res5b.json.length === 0, "TEST 5.5: Non-existent search returns empty array");

        // Missing query parameters
        const res5c = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: "/api/search?source=OnlySource",
            method: "GET"
        });
        assert(res5c.statusCode === 400, "TEST 5.6: Incomplete search parameters rejected with 400 Bad Request");

        // TEST 6: Individual bus details
        console.log("\n--- TEST 6: View individual bus details (GET /api/buses/:id) ---");
        const res6 = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: `/api/buses/${createdTestBusId}`,
            method: "GET"
        });
        assert(res6.statusCode === 200, "TEST 6.1: Valid bus ID returns 200 OK");
        assert(res6.json && res6.json.bus && res6.json.bus.available_seats === 30, "TEST 6.2: Available seats equals total_seats initially");

        const res6b = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: "/api/buses/999999",
            method: "GET"
        });
        assert(res6b.statusCode === 404, "TEST 6.3: Non-existent bus ID returns 404 Not Found");

        // TEST 7: Book tickets (POST /api/reservations)
        console.log("\n--- TEST 7: Book tickets (POST /api/reservations) ---");
        const res7 = await request(
            {
                hostname: "localhost",
                port: TEST_PORT,
                path: "/api/reservations",
                method: "POST",
                headers: { "Content-Type": "application/json" }
            },
            JSON.stringify({
                bus_id: createdTestBusId,
                passenger_name: "Test Passenger Alpha",
                seats_booked: 5
            })
        );
        assert(res7.statusCode === 201, "TEST 7.1: Valid booking returns 201 Created");
        assert(res7.json && res7.json.reservation_id > 0, "TEST 7.2: Reservation ID generated");
        assert(res7.json && res7.json.reservation.remaining_seats === 25, "TEST 7.3: Remaining seats reported as 25");
        createdTestResId = res7.json ? res7.json.reservation_id : null;

        // Verify bus availability decreased
        const res7b = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: `/api/buses/${createdTestBusId}`,
            method: "GET"
        });
        assert(
            res7b.json && res7b.json.bus && res7b.json.bus.available_seats === 25,
            "TEST 7.4: Bus available seats correctly reduced to 25 in database"
        );

        // TEST 8: Insufficient seats / Overbooking rejection
        console.log("\n--- TEST 8: Prevent overselling seats ---");
        // Attempt to book 26 seats when only 25 remain
        const res8 = await request(
            {
                hostname: "localhost",
                port: TEST_PORT,
                path: "/api/reservations",
                method: "POST",
                headers: { "Content-Type": "application/json" }
            },
            JSON.stringify({
                bus_id: createdTestBusId,
                passenger_name: "Greedy Passenger",
                seats_booked: 26
            })
        );
        assert(res8.statusCode === 409, "TEST 8.1: Overbooking rejected with 409 Conflict");
        assert(
            res8.json && res8.json.success === false && res8.json.available_seats === 25,
            "TEST 8.2: 409 response indicates remaining available seats"
        );

        // Verify available seats remained intact (not decremented by failed booking)
        const res8b = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: `/api/buses/${createdTestBusId}`,
            method: "GET"
        });
        assert(
            res8b.json && res8b.json.bus && res8b.json.bus.available_seats === 25,
            "TEST 8.3: Transaction rollback ensured seats remained at 25"
        );

        // TEST 9: View reservations (GET /api/reservations)
        console.log("\n--- TEST 9: View reservations (GET /api/reservations) ---");
        const res9 = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: "/api/reservations",
            method: "GET"
        });
        assert(res9.statusCode === 200, "TEST 9.1: Reservations returns 200 OK");
        assert(Array.isArray(res9.json), "TEST 9.2: Returns array of reservations");
        const foundTestRes = res9.json.find((r) => r.reservation_id === createdTestResId);
        assert(foundTestRes !== undefined, "TEST 9.3: Created reservation exists in list");
        assert(
            foundTestRes && foundTestRes.service_no === "TEST-999" && foundTestRes.source === "Testville",
            "TEST 9.4: Reservation correctly joined with bus details (service_no, source, destination)"
        );

        // TEST 10: Cancel reservation (DELETE /api/reservations/:id)
        console.log("\n--- TEST 10: Cancel reservation & seat restoration ---");
        const res10 = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: `/api/reservations/${createdTestResId}`,
            method: "DELETE"
        });
        assert(res10.statusCode === 200, "TEST 10.1: Cancellation returns 200 OK");
        assert(res10.json && res10.json.success === true, "TEST 10.2: Success flag true on cancellation");

        // Verify reservation no longer exists
        const res10b = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: `/api/reservations/${createdTestResId}`,
            method: "GET"
        });
        assert(res10b.statusCode === 404, "TEST 10.3: Cancelled reservation returns 404 Not Found");

        // Verify seats restored back to 30
        const res10c = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: `/api/buses/${createdTestBusId}`,
            method: "GET"
        });
        assert(
            res10c.json && res10c.json.bus && res10c.json.bus.available_seats === 30,
            "TEST 10.4: Available seats restored to 30 after cancellation"
        );

        // TEST 11: API Error handling & JSON guarantee
        console.log("\n--- TEST 11: API error handling & non-HTML responses ---");
        // Unknown endpoint
        const res11a = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: "/api/nonexistent_endpoint_xyz",
            method: "GET"
        });
        assert(res11a.statusCode === 404, "TEST 11.1: Unknown API endpoint returns 404");
        assert(res11a.json && res11a.json.success === false, "TEST 11.2: Unknown API returns JSON 404 (not HTML)");

        // Malformed JSON body
        const res11b = await request(
            {
                hostname: "localhost",
                port: TEST_PORT,
                path: "/api/buses",
                method: "POST",
                headers: { "Content-Type": "application/json" }
            },
            "{bad-json"
        );
        assert(res11b.statusCode === 400, "TEST 11.3: Malformed JSON handled with 400");
        assert(
            res11b.json && res11b.json.success === false,
            "TEST 11.4: Malformed JSON returns clean JSON error (not HTML crash)"
        );

        // CONCURRENCY TEST: Simultaneous requests attempting to oversell seats
        console.log("\n--- CONCURRENCY TEST: Parallel simultaneous booking race condition ---");
        const concBusRes = await request(
            {
                hostname: "localhost",
                port: TEST_PORT,
                path: "/api/buses",
                method: "POST",
                headers: { "Content-Type": "application/json" }
            },
            JSON.stringify({
                service_no: "CONCUR-101",
                source: "Alpha",
                destination: "Beta",
                departure_date: "2026-12-01",
                departure_time: "09:00",
                total_seats: 5
            })
        );
        const concBusId = concBusRes.json.bus_id;

        // Fire 2 concurrent booking requests for 4 seats each (total 8 seats requested on 5-seat bus)
        const [concReq1, concReq2] = await Promise.all([
            request(
                {
                    hostname: "localhost",
                    port: TEST_PORT,
                    path: "/api/reservations",
                    method: "POST",
                    headers: { "Content-Type": "application/json" }
                },
                JSON.stringify({
                    bus_id: concBusId,
                    passenger_name: "Simultaneous Buyer 1",
                    seats_booked: 4
                })
            ),
            request(
                {
                    hostname: "localhost",
                    port: TEST_PORT,
                    path: "/api/reservations",
                    method: "POST",
                    headers: { "Content-Type": "application/json" }
                },
                JSON.stringify({
                    bus_id: concBusId,
                    passenger_name: "Simultaneous Buyer 2",
                    seats_booked: 4
                })
            )
        ]);

        const concStatuses = [concReq1.statusCode, concReq2.statusCode].sort();
        assert(
            concStatuses[0] === 201 && concStatuses[1] === 409,
            "CONCURRENCY: Exactly one booking succeeded (201) and one was safely rejected (409 Conflict)",
            `Got statuses: ${concStatuses.join(", ")}`
        );

        // Verify remaining seat is exactly 1 (5 - 4)
        const concVerify = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: `/api/buses/${concBusId}`,
            method: "GET"
        });
        assert(
            concVerify.json && concVerify.json.bus && concVerify.json.bus.available_seats === 1,
            "CONCURRENCY: Database available_seats is exactly 1 without overselling"
        );

        // Clean up concurrency bus and its reservation
        await new Promise((resolve) => {
            db.query("DELETE FROM reservations WHERE bus_id = ?", [concBusId], () => {
                db.query("DELETE FROM buses WHERE bus_id = ?", [concBusId], () => {
                    resolve();
                });
            });
        });

        // TEST 12: Regression check of original buses
        console.log("\n--- TEST 12: Regression check on existing artc data ---");
        const res12 = await request({
            hostname: "localhost",
            port: TEST_PORT,
            path: "/api/buses",
            method: "GET"
        });
        const bus1 = res12.json.find((b) => b.bus_id === 1);
        assert(
            bus1 && bus1.source === "Kurnool" && bus1.destination === "Hyderabad" && bus1.total_seats === 40,
            "TEST 12.1: Original Bus #1 is intact with correct route and capacity"
        );
        assert(
            bus1 && bus1.departure_date === "2026-10-20",
            "TEST 12.2: Original Bus #1 departure_date is exact '2026-10-20'"
        );
        assert(
            bus1 && bus1.available_seats === 38,
            "TEST 12.3: Original Bus #1 available_seats is 38 (40 total - 2 booked for Ravi)"
        );

        // Clean up test bus from database
        console.log("\n--- CLEANUP: Removing test bus record ---");
        if (createdTestBusId) {
            await new Promise((resolve) => {
                db.query("DELETE FROM buses WHERE bus_id = ?", [createdTestBusId], (err) => {
                    if (err) console.error("Cleanup error:", err.message);
                    else console.log(`Cleaned up test bus #${createdTestBusId}`);
                    resolve();
                });
            });
        }

    } catch (testErr) {
        console.error("Test execution exception:", testErr);
        failedTests++;
    } finally {
        if (server) {
            server.close();
        }
        db.end(() => {
            console.log("\n==================================================");
            console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
            console.log("==================================================");
            process.exit(failedTests > 0 ? 1 : 0);
        });
    }
}

runTests();
