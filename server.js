const express = require("express");
const mysql = require("mysql8");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// 1. MIDDLEWARE
// ========================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Handle JSON body parser syntax errors so client always gets JSON
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.status(400).json({
            success: false,
            message: "Invalid JSON payload provided."
        });
    }
    next(err);
});
const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "anand",
    database: process.env.DB_NAME || "artc",
    port: Number(process.env.DB_PORT) || 3306,
    connectionLimit: 10,
    dateStrings: true
});

// Test initial database connection
db.getConnection((err, conn) => {
    if (err) {
        console.error("MySQL connection failed:", err.message);
        return;
    }
    console.log("Connected to MySQL database: " + (process.env.DB_NAME || "artc"));
    conn.release();
});

// ========================================
// 3. UTILITY FUNCTIONS
// ========================================

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

function isValidTime(value) {
    if (typeof value !== "string") {
        return false;
    }
    return /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/.test(value);
}

// ========================================
// 4. MODULE 1: BUS MANAGEMENT
// ========================================

// POST /api/buses - Add a new bus
app.post("/api/buses", (req, res) => {
    const {
        service_no,
        source,
        destination,
        departure_date,
        departure_time,
        total_seats
    } = req.body;

    const trimmedService = typeof service_no === "string" ? service_no.trim() : "";
    const trimmedSource = typeof source === "string" ? source.trim() : "";
    const trimmedDest = typeof destination === "string" ? destination.trim() : "";
    const parsedSeats = Number(total_seats);

    if (
        !trimmedService ||
        !trimmedSource ||
        !trimmedDest ||
        typeof departure_date !== "string" ||
        !departure_date ||
        typeof departure_time !== "string" ||
        !departure_time ||
        !Number.isInteger(parsedSeats) ||
        parsedSeats < 1
    ) {
        return res.status(400).json({
            success: false,
            message: "Please enter all bus details correctly. Total seats must be at least 1."
        });
    }

    if (!isValidDate(departure_date)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid departure date in YYYY-MM-DD format."
        });
    }

    if (!isValidTime(departure_time)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid departure time in HH:MM format."
        });
    }

    const formattedTime = departure_time.length === 5 ? departure_time + ":00" : departure_time;

    const sql = `
        INSERT INTO buses (
            service_no,
            source,
            destination,
            departure_date,
            departure_time,
            total_seats
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    const values = [
        trimmedService,
        trimmedSource,
        trimmedDest,
        departure_date,
        formattedTime,
        parsedSeats
    ];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Add Bus Error:", err.message);
            return res.status(500).json({
                success: false,
                message: "Unable to add bus.",
                error: err.message
            });
        }

        return res.status(201).json({
            success: true,
            message: "Bus added successfully!",
            bus_id: result.insertId,
            bus: {
                bus_id: result.insertId,
                service_no: trimmedService,
                source: trimmedSource,
                destination: trimmedDest,
                departure_date: departure_date,
                departure_time: formattedTime,
                total_seats: parsedSeats,
                available_seats: parsedSeats
            }
        });
    });
});

// GET /api/buses - View all buses with available seats
app.get("/api/buses", (req, res) => {
    const sql = `
        SELECT
            b.bus_id,
            b.service_no,
            b.source,
            b.destination,
            b.departure_date,
            b.departure_time,
            b.total_seats,
            CAST(b.total_seats - COALESCE(r.booked_seats, 0) AS SIGNED) AS available_seats
        FROM buses AS b
        LEFT JOIN (
            SELECT
                bus_id,
                SUM(seats_booked) AS booked_seats
            FROM reservations
            GROUP BY bus_id
        ) AS r ON b.bus_id = r.bus_id
        ORDER BY b.departure_date ASC, b.departure_time ASC, b.bus_id ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("View Buses Error:", err.message);
            return res.status(500).json({
                success: false,
                message: "Unable to retrieve buses.",
                error: err.message
            });
        }

        return res.json(results);
    });
});

// GET /api/buses/:id - View individual bus details
app.get("/api/buses/:id", (req, res) => {
    const busId = Number(req.params.id);

    if (!Number.isInteger(busId) || busId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid Bus ID. Must be a positive integer."
        });
    }

    const sql = `
        SELECT
            b.bus_id,
            b.service_no,
            b.source,
            b.destination,
            b.departure_date,
            b.departure_time,
            b.total_seats,
            CAST(b.total_seats - COALESCE(r.booked_seats, 0) AS SIGNED) AS available_seats
        FROM buses AS b
        LEFT JOIN (
            SELECT
                bus_id,
                SUM(seats_booked) AS booked_seats
            FROM reservations
            WHERE bus_id = ?
            GROUP BY bus_id
        ) AS r ON b.bus_id = r.bus_id
        WHERE b.bus_id = ?
    `;

    db.query(sql, [busId, busId], (err, results) => {
        if (err) {
            console.error("Get Bus Details Error:", err.message);
            return res.status(500).json({
                success: false,
                message: "Unable to retrieve bus details.",
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Bus with ID ${busId} not found.`
            });
        }

        return res.json({
            success: true,
            bus: results[0]
        });
    });
});

// ========================================
// 5. MODULE 2: SEARCH BUSES
// GET /api/locations - Distinct source/destination for dropdowns
// GET /api/search?source=...&destination=...&date=...
// ========================================

app.get("/api/locations", (req, res) => {
    const sql = `
        SELECT DISTINCT TRIM(source) AS name FROM buses
        UNION
        SELECT DISTINCT TRIM(destination) AS name FROM buses
        ORDER BY name ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Get Locations Error:", err.message);
            return res.status(500).json({
                success: false,
                message: "Unable to retrieve locations.",
                error: err.message
            });
        }

        const locations = results.map(r => r.name);
        return res.json({ success: true, locations });
    });
});

app.get("/api/search", (req, res) => {
    const source = String(req.query.source || "").trim();
    const destination = String(req.query.destination || "").trim();
    const date = String(req.query.date || "").trim();

    if (!source || !destination) {
        return res.status(400).json({
            success: false,
            message: "Source and destination are required for search."
        });
    }

    if (date && !isValidDate(date)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid departure date in YYYY-MM-DD format."
        });
    }

    let sql = `
        SELECT
            b.bus_id,
            b.service_no,
            b.source,
            b.destination,
            b.departure_date,
            b.departure_time,
            b.total_seats,
            CAST(b.total_seats - COALESCE(r.booked_seats, 0) AS SIGNED) AS available_seats
        FROM buses AS b
        LEFT JOIN (
            SELECT
                bus_id,
                SUM(seats_booked) AS booked_seats
            FROM reservations
            GROUP BY bus_id
        ) AS r ON b.bus_id = r.bus_id
        WHERE LOWER(TRIM(b.source)) = LOWER(?)
          AND LOWER(TRIM(b.destination)) = LOWER(?)
    `;

    const params = [source, destination];

    if (date) {
        sql += `          AND b.departure_date = ?\n`;
        params.push(date);
    }

    sql += `        ORDER BY b.departure_date ASC, b.departure_time ASC\n    `;

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("Search Bus Error:", err.message);
            return res.status(500).json({
                success: false,
                message: "Unable to search buses.",
                error: err.message
            });
        }

        return res.json(results);
    });
});

// ========================================
// 6. MODULE 4: PASSENGER RESERVATION (CONCURRENCY-SAFE)
// POST /api/reservations
// ========================================

app.post("/api/reservations", (req, res) => {
    const { passenger_name, bus_id, seats_booked } = req.body;

    const trimmedPassenger = typeof passenger_name === "string" ? passenger_name.trim() : "";
    const parsedBusId = Number(bus_id);
    const parsedSeats = Number(seats_booked);

    // Validate inputs
    if (!trimmedPassenger || trimmedPassenger.length > 100) {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid passenger name (1-100 characters)."
        });
    }

    if (!Number.isInteger(parsedBusId) || parsedBusId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid Bus ID."
        });
    }

    if (!Number.isInteger(parsedSeats) || parsedSeats < 1) {
        return res.status(400).json({
            success: false,
            message: "Number of seats must be a positive integer (at least 1)."
        });
    }

    // Critical Concurrency Safety:
    // Acquire dedicated connection from pool, begin transaction, and place row lock (SELECT FOR UPDATE)
    db.getConnection((connErr, conn) => {
        if (connErr) {
            console.error("DB Pool Connection Error:", connErr.message);
            return res.status(500).json({
                success: false,
                message: "Database connection failed. Please try again."
            });
        }

        conn.beginTransaction((txErr) => {
            if (txErr) {
                conn.release();
                console.error("Transaction Begin Error:", txErr.message);
                return res.status(500).json({
                    success: false,
                    message: "Failed to initiate reservation transaction."
                });
            }

            // Step 1: Lock the bus record exclusively for update to prevent race conditions
            const lockBusSql = `
                SELECT
                    bus_id,
                    service_no,
                    source,
                    destination,
                    departure_date,
                    departure_time,
                    total_seats
                FROM buses
                WHERE bus_id = ?
                FOR UPDATE
            `;

            conn.query(lockBusSql, [parsedBusId], (busErr, busResults) => {
                if (busErr) {
                    return conn.rollback(() => {
                        conn.release();
                        console.error("Lock Bus Query Error:", busErr.message);
                        res.status(500).json({
                            success: false,
                            message: "Database error while verifying bus availability."
                        });
                    });
                }

                if (busResults.length === 0) {
                    return conn.rollback(() => {
                        conn.release();
                        res.status(404).json({
                            success: false,
                            message: `Bus with ID ${parsedBusId} does not exist.`
                        });
                    });
                }

                const bus = busResults[0];

                // Step 2: Calculate current total booked seats within this locked transaction
                const bookedSql = `
                    SELECT COALESCE(SUM(seats_booked), 0) AS booked_seats
                    FROM reservations
                    WHERE bus_id = ?
                `;

                conn.query(bookedSql, [parsedBusId], (bookedErr, bookedResults) => {
                    if (bookedErr) {
                        return conn.rollback(() => {
                            conn.release();
                            console.error("Calculate Booked Seats Error:", bookedErr.message);
                            res.status(500).json({
                                success: false,
                                message: "Database error while calculating seat availability."
                            });
                        });
                    }

                    const currentBooked = Number(bookedResults[0].booked_seats) || 0;
                    const availableSeats = bus.total_seats - currentBooked;

                    // Step 3: Verify seat capacity
                    if (availableSeats < parsedSeats) {
                        return conn.rollback(() => {
                            conn.release();
                            res.status(409).json({
                                success: false,
                                message: `Cannot book ${parsedSeats} seat(s). Only ${availableSeats} seat(s) remaining for this bus.`,
                                available_seats: availableSeats
                            });
                        });
                    }

                    // Step 4: Insert reservation
                    const insertSql = `
                        INSERT INTO reservations (passenger_name, bus_id, seats_booked)
                        VALUES (?, ?, ?)
                    `;

                    conn.query(insertSql, [trimmedPassenger, parsedBusId, parsedSeats], (insErr, insResult) => {
                        if (insErr) {
                            return conn.rollback(() => {
                                conn.release();
                                console.error("Insert Reservation Error:", insErr.message);
                                res.status(500).json({
                                    success: false,
                                    message: "Failed to record reservation."
                                });
                            });
                        }

                        // Step 5: Commit transaction
                        conn.commit((commitErr) => {
                            if (commitErr) {
                                return conn.rollback(() => {
                                    conn.release();
                                    console.error("Commit Error:", commitErr.message);
                                    res.status(500).json({
                                        success: false,
                                        message: "Failed to finalize reservation."
                                    });
                                });
                            }

                            conn.release();
                            const newAvailableSeats = availableSeats - parsedSeats;

                            return res.status(201).json({
                                success: true,
                                message: "Reservation successful!",
                                reservation_id: insResult.insertId,
                                reservation: {
                                    reservation_id: insResult.insertId,
                                    passenger_name: trimmedPassenger,
                                    bus_id: parsedBusId,
                                    service_no: bus.service_no,
                                    source: bus.source,
                                    destination: bus.destination,
                                    departure_date: bus.departure_date,
                                    departure_time: bus.departure_time,
                                    seats_booked: parsedSeats,
                                    remaining_seats: newAvailableSeats
                                }
                            });
                        });
                    });
                });
            });
        });
    });
});

// ========================================
// 7. MODULE 5: VIEW RESERVATIONS
// GET /api/reservations
// ========================================

app.get("/api/reservations", (req, res) => {
    const sql = `
        SELECT
            r.reservation_id,
            r.passenger_name,
            r.bus_id,
            b.service_no,
            b.source,
            b.destination,
            b.departure_date,
            b.departure_time,
            r.seats_booked,
            r.booking_date
        FROM reservations AS r
        JOIN buses AS b ON r.bus_id = b.bus_id
        ORDER BY r.reservation_id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("View Reservations Error:", err.message);
            return res.status(500).json({
                success: false,
                message: "Unable to retrieve reservations.",
                error: err.message
            });
        }

        return res.json(results);
    });
});

// GET /api/reservations/:id - View single reservation details
app.get("/api/reservations/:id", (req, res) => {
    const resId = Number(req.params.id);

    if (!Number.isInteger(resId) || resId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid Reservation ID. Must be a positive integer."
        });
    }

    const sql = `
        SELECT
            r.reservation_id,
            r.passenger_name,
            r.bus_id,
            b.service_no,
            b.source,
            b.destination,
            b.departure_date,
            b.departure_time,
            r.seats_booked,
            r.booking_date
        FROM reservations AS r
        JOIN buses AS b ON r.bus_id = b.bus_id
        WHERE r.reservation_id = ?
    `;

    db.query(sql, [resId], (err, results) => {
        if (err) {
            console.error("Get Reservation Error:", err.message);
            return res.status(500).json({
                success: false,
                message: "Unable to retrieve reservation details.",
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Reservation with ID ${resId} not found.`
            });
        }

        return res.json({
            success: true,
            reservation: results[0]
        });
    });
});

// ========================================
// 8. MODULE 6: CANCEL RESERVATION
// DELETE /api/reservations/:id
// ========================================

app.delete("/api/reservations/:id", (req, res) => {
    const resId = Number(req.params.id);

    if (!Number.isInteger(resId) || resId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid Reservation ID. Must be a positive integer."
        });
    }

    // Step 1: Verify the reservation exists
    const checkSql = "SELECT reservation_id, passenger_name, bus_id, seats_booked FROM reservations WHERE reservation_id = ?";

    db.query(checkSql, [resId], (checkErr, checkResults) => {
        if (checkErr) {
            console.error("Check Reservation Error:", checkErr.message);
            return res.status(500).json({
                success: false,
                message: "Database error while verifying reservation.",
                error: checkErr.message
            });
        }

        if (checkResults.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Reservation #${resId} does not exist.`
            });
        }

        const reservation = checkResults[0];

        // Step 2: Delete the reservation
        const deleteSql = "DELETE FROM reservations WHERE reservation_id = ?";

        db.query(deleteSql, [resId], (delErr) => {
            if (delErr) {
                console.error("Cancel Reservation Error:", delErr.message);
                return res.status(500).json({
                    success: false,
                    message: "Unable to cancel reservation.",
                    error: delErr.message
                });
            }

            return res.json({
                success: true,
                message: `Reservation #${resId} for passenger "${reservation.passenger_name}" has been successfully cancelled.`,
                reservation_id: resId,
                seats_freed: reservation.seats_booked,
                bus_id: reservation.bus_id
            });
        });
    });
});

// ========================================
// 9. SUMMARY DASHBOARD STATS
// GET /api/stats
// ========================================

app.get("/api/stats", (req, res) => {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM buses) AS total_buses,
            (SELECT COUNT(*) FROM reservations) AS total_reservations,
            (SELECT COALESCE(SUM(seats_booked), 0) FROM reservations) AS total_seats_booked,
            (SELECT COALESCE(SUM(total_seats), 0) FROM buses) AS total_capacity
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Get Stats Error:", err.message);
            return res.status(500).json({
                success: false,
                message: "Unable to retrieve system statistics."
            });
        }

        const data = results[0];
        const totalCapacity = Number(data.total_capacity) || 0;
        const totalBooked = Number(data.total_seats_booked) || 0;
        const availableSeats = totalCapacity - totalBooked;

        return res.json({
            success: true,
            total_buses: Number(data.total_buses) || 0,
            total_reservations: Number(data.total_reservations) || 0,
            total_seats_booked: totalBooked,
            total_capacity: totalCapacity,
            total_available_seats: availableSeats
        });
    });
});

// ========================================
// 10. SERVE STATIC FILES
// ========================================

app.use(express.static(path.join(__dirname, "public")));

// ========================================
// 11. API NOT FOUND HANDLER (JSON 404)
// IMPORTANT: Registered after all API routes
// ========================================

app.use("/api", (req, res) => {
    return res.status(404).json({
        success: false,
        message: `API endpoint not found: ${req.method} ${req.originalUrl}`
    });
});

// ========================================
// 12. GLOBAL ERROR HANDLER
// Ensures API requests always receive JSON
// ========================================

app.use((err, req, res, next) => {
    console.error("Unhandled Error:", err);

    if (req.originalUrl && req.originalUrl.startsWith("/api")) {
        return res.status(err.status || 500).json({
            success: false,
            message: err.message || "An internal server error occurred."
        });
    }

    return res.status(500).send("Internal Server Error");
});

// ========================================
// 13. 404 FALLBACK HANDLER
// ========================================

app.use((req, res) => {
    // For API routes, return JSON 404
    if (req.path.startsWith("/api")) {
        return res.status(404).json({ success: false, message: "API endpoint not found." });
    }
    // For page routes, redirect to dashboard
    return res.redirect("/index.html");
});

// ========================================
// 14. START SERVER (Export app and db for testing/modules)
// ========================================

const isDirectRun = require.main === module || 
    (require.main && require.main.filename && (
        require.main.filename.endsWith("app1.js") || 
        require.main.filename.endsWith("server.js")
    ));

if (isDirectRun) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

module.exports = { app, db };

