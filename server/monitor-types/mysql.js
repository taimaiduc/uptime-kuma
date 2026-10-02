const { MonitorType } = require("./monitor-type");
const { UP } = require("../../src/util");
const dayjs = require("dayjs");
const mysql = require("mysql2");
const { ConditionVariable } = require("../monitor-conditions/variables");
const { defaultStringOperators, defaultNumberOperators } = require("../monitor-conditions/operators");
const { ConditionExpressionGroup } = require("../monitor-conditions/expression");
const { evaluateExpressionGroup } = require("../monitor-conditions/evaluator");

class MysqlMonitorType extends MonitorType {
    name = "mysql";

    supportsConditions = true;
    conditionVariables = [
        new ConditionVariable("result", defaultStringOperators),
        new ConditionVariable("row_count", defaultNumberOperators),
    ];

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, _server) {
        let query = monitor.databaseQuery;
        if (!query || (typeof query === "string" && query.trim() === "")) {
            query = "SELECT 1";
        }

        // Use `radius_password` as `password` field for backwards compatibility
        // TODO: rename `radius_password` to `password` later for general use
        const password = monitor.radiusPassword;

        const conditions = monitor.conditions ? ConditionExpressionGroup.fromMonitor(monitor) : null;
        const hasConditions = conditions && conditions.children && conditions.children.length > 0;

        const startTime = dayjs().valueOf();
        try {
            if (hasConditions) {
                const rows = await this.mysqlQueryRows(monitor.databaseConnectionString, query, password);
                heartbeat.ping = dayjs().valueOf() - startTime;

                const context = { row_count: rows.length };
                let detail = `rows: ${rows.length}`;

                // Only require a single value result when a condition actually tests "result"
                if (collectConditionVariables(conditions).has("result")) {
                    const result = this.extractSingleValue(rows);
                    context.result = String(result);
                    detail = String(result);
                }

                const conditionsResult = evaluateExpressionGroup(conditions, context);

                if (!conditionsResult) {
                    throw new Error(`Query result did not meet the specified conditions (${detail})`);
                }

                heartbeat.status = UP;
                heartbeat.msg = "Query did meet specified conditions";
            } else {
                // Backwards compatible: just check connection and return row count
                const result = await this.mysqlQuery(monitor.databaseConnectionString, query, password);
                heartbeat.ping = dayjs().valueOf() - startTime;
                heartbeat.status = UP;
                heartbeat.msg = result;
            }
        } catch (error) {
            heartbeat.ping = dayjs().valueOf() - startTime;
            // Re-throw condition errors as-is, wrap database errors
            if (error.message.includes("did not meet the specified conditions")) {
                throw error;
            }
            throw new Error(`Database connection/query failed: ${error.message}`);
        }
    }

    /**
     * Run a query on MySQL/MariaDB (backwards compatible - returns row count)
     * @param {string} connectionString The database connection string
     * @param {string} query The query to execute
     * @param {string} password Optional password override
     * @returns {Promise<string>} Row count message
     */
    mysqlQuery(connectionString, query, password = undefined) {
        return new Promise((resolve, reject) => {
            const connection = mysql.createConnection({
                uri: connectionString,
                password,
            });

            connection.on("error", (err) => {
                reject(err);
            });

            connection.query(query, (err, res) => {
                try {
                    connection.end();
                } catch (_) {
                    connection.destroy();
                }

                if (err) {
                    reject(err);
                    return;
                }

                if (Array.isArray(res)) {
                    resolve("Rows: " + res.length);
                } else {
                    resolve("No Error, but the result is not an array. Type: " + typeof res);
                }
            });
        });
    }

    /**
     * Run a query on MySQL/MariaDB and return the result rows
     * @param {string} connectionString The database connection string
     * @param {string} query The query to execute
     * @param {string} password Optional password override
     * @returns {Promise<object[]>} Result rows
     */
    mysqlQueryRows(connectionString, query, password = undefined) {
        return new Promise((resolve, reject) => {
            const connection = mysql.createConnection({
                uri: connectionString,
                password,
            });

            connection.on("error", (err) => {
                reject(err);
            });

            connection.query(query, (err, res) => {
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
                    reject(new Error("No Error, but the result is not an array. Type: " + typeof res));
                    return;
                }

                resolve(res);
            });
        });
    }

    /**
     * Extract a single value from query result rows
     * @param {object[]} res Result rows
     * @returns {any} Single value from the first column of the first row
     * @throws {Error} If the result is not exactly one row with one column
     */
    extractSingleValue(res) {
        // Check if we have results
        if (res.length === 0) {
            throw new Error("Query returned no results");
        }

        // Check if we have multiple rows
        if (res.length > 1) {
            throw new Error("Multiple values were found, expected only one value");
        }

        const firstRow = res[0];
        const columnNames = Object.keys(firstRow);

        // Check if we have multiple columns
        if (columnNames.length > 1) {
            throw new Error("Multiple columns were found, expected only one value");
        }

        // Return the single value from the first (and only) column
        return firstRow[columnNames[0]];
    }
}

/**
 * Collect all variable IDs referenced by a condition group
 * @param {ConditionExpressionGroup} group Condition group
 * @param {Set<string>} vars Accumulator
 * @returns {Set<string>} Referenced variable IDs
 */
function collectConditionVariables(group, vars = new Set()) {
    for (const child of group.children) {
        if (child instanceof ConditionExpressionGroup) {
            collectConditionVariables(child, vars);
        } else {
            vars.add(child.variable);
        }
    }
    return vars;
}

module.exports = {
    MysqlMonitorType,
};
