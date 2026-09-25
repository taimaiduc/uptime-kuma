const { checkLogin } = require("../util-server");
const { log } = require("../../src/util");
const mysql = require("mysql2");
const mssql = require("mssql");
const { PostgresMonitorType } = require("../monitor-types/postgres");

// Only return the first rows to the UI, the query itself is not modified
const MAX_ROWS = 100;
const QUERY_TIMEOUT_MS = 30 * 1000;

/**
 * Convert a database value to something that can be shown in a table cell
 * @param {any} value Raw value from the database driver
 * @returns {string|number|boolean|null} Displayable value
 */
function toCellValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? String(value) : value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
        return `<binary ${value.length} bytes>`;
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return value;
}

/**
 * Build the result sent to the frontend
 * @param {string[]} columns Column names
 * @param {object[]} rows Rows as objects
 * @returns {{columns: string[], rows: Array<Array<any>>, total: number, truncated: boolean}} Table data
 */
function buildTable(columns, rows) {
    if (columns.length === 0 && rows.length > 0) {
        columns = Object.keys(rows[0]);
    }
    return {
        columns,
        rows: rows.slice(0, MAX_ROWS).map((row) => columns.map((col) => toCellValue(row[col]))),
        total: rows.length,
        truncated: rows.length > MAX_ROWS,
    };
}

/**
 * Run a query on MySQL/MariaDB
 * @param {string} connectionString Connection string
 * @param {string} password Password
 * @param {string} query Query
 * @returns {Promise<object>} Table data
 */
function runMysql(connectionString, password, query) {
    return new Promise((resolve, reject) => {
        const connection = mysql.createConnection({
            uri: connectionString,
            password: password || undefined,
            connectTimeout: 10 * 1000,
        });

        connection.on("error", reject);

        connection.query({ sql: query, timeout: QUERY_TIMEOUT_MS }, (err, res, fields) => {
            try {
                connection.end();
            } catch (_) {
                connection.destroy();
            }

            if (err) {
                reject(err);
                return;
            }

            if (!Array.isArray(res)) {
                resolve(buildTable(["affectedRows"], [{ affectedRows: res?.affectedRows }]));
                return;
            }

            const columns = Array.isArray(fields) ? fields.map((f) => f.name) : [];
            resolve(buildTable(columns, res));
        });
    });
}

/**
 * Run a query on PostgreSQL
 * @param {string} connectionString Connection string
 * @param {string} query Query
 * @returns {Promise<object>} Table data
 */
async function runPostgres(connectionString, query) {
    const res = await new PostgresMonitorType().postgresQuery(connectionString, query);
    const result = Array.isArray(res) ? res[res.length - 1] : res;
    const columns = (result.fields || []).map((f) => f.name);
    return buildTable(columns, result.rows || []);
}

/**
 * Run a query on SQL Server
 * @param {string} connectionString Connection string
 * @param {string} query Query
 * @returns {Promise<object>} Table data
 */
async function runMssql(connectionString, query) {
    let pool;
    try {
        pool = new mssql.ConnectionPool(connectionString);
        await pool.connect();
        const result = await pool.request().query(query);
        const recordset = result.recordset || [];
        const columns = recordset.columns ? Object.keys(recordset.columns) : [];
        return buildTable(columns, recordset);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * Run a query on Oracle Database
 * @param {string} connectionString Connection string
 * @param {string} username Username
 * @param {string} password Password
 * @param {string} query Query
 * @returns {Promise<object>} Table data
 */
async function runOracle(connectionString, username, password, query) {
    const oracledb = require("oracledb");
    let connection;
    try {
        connection = await oracledb.getConnection({
            connectString: (connectionString || "").trim(),
            user: (username || "").trim(),
            password: (password || "").trim(),
        });
        const result = await connection.execute(query, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            maxRows: MAX_ROWS + 1,
        });
        const columns = (result.metaData || []).map((m) => m.name);
        return buildTable(columns, result.rows || []);
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

/**
 * Handlers for running a SQL query from the edit monitor page
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.sqlPreviewSocketHandler = (socket) => {
    socket.on("runSqlQuery", async (monitor, callback) => {
        try {
            checkLogin(socket);

            let query = monitor?.databaseQuery;
            if (!query || query.trim() === "") {
                query = monitor?.type === "oracledb" ? "SELECT 1 FROM DUAL" : "SELECT 1";
            }

            let task;
            switch (monitor?.type) {
                case "mysql":
                    task = runMysql(monitor.databaseConnectionString, monitor.radiusPassword, query);
                    break;
                case "postgres":
                    task = runPostgres(monitor.databaseConnectionString, query);
                    break;
                case "sqlserver":
                    task = runMssql(monitor.databaseConnectionString, query);
                    break;
                case "oracledb":
                    task = runOracle(
                        monitor.databaseConnectionString,
                        monitor.basic_auth_user,
                        monitor.basic_auth_pass,
                        query
                    );
                    break;
                default:
                    throw new Error("Unsupported monitor type: " + monitor?.type);
            }

            const startTime = Date.now();
            let timer;
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("Query timed out")), QUERY_TIMEOUT_MS);
            });
            let result;
            try {
                result = await Promise.race([task, timeout]);
            } finally {
                clearTimeout(timer);
            }

            callback({
                ok: true,
                ...result,
                duration: Date.now() - startTime,
            });
        } catch (e) {
            log.debug("sql-preview", e.message);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
