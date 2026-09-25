exports.up = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        table.boolean("skip_time_enabled").notNullable().defaultTo(false);
        table.string("skip_time_start", 5);
        table.string("skip_time_end", 5);
    });
};

exports.down = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        table.dropColumn("skip_time_enabled");
        table.dropColumn("skip_time_start");
        table.dropColumn("skip_time_end");
    });
};
