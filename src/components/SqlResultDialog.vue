<template>
    <div ref="modal" class="modal fade" tabindex="-1">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        {{ $t("sqlResultTitle") }}
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" :aria-label="$t('Close')" />
                </div>
                <div class="modal-body">
                    <div v-if="processing" class="text-center my-4">
                        <div class="spinner-border" role="status"></div>
                    </div>

                    <div v-else-if="error" class="alert alert-danger mb-0">{{ error }}</div>

                    <template v-else-if="result">
                        <p class="form-text mt-0">
                            {{ $t("sqlResultSummary", [result.total, result.duration]) }}
                            <span v-if="result.truncated">{{ $t("sqlResultTruncated", [result.rows.length]) }}</span>
                        </p>
                        <div v-if="result.columns.length > 0" class="table-responsive">
                            <table class="table table-sm table-striped table-bordered sql-result-table">
                                <thead>
                                    <tr>
                                        <th v-for="(column, index) in result.columns" :key="index">{{ column }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="(row, rowIndex) in result.rows" :key="rowIndex">
                                        <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                                            <span v-if="cell === null" class="text-secondary">NULL</span>
                                            <template v-else>{{ cell }}</template>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p v-else class="mb-0">{{ $t("sqlResultNoRows") }}</p>
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";

export default {
    data() {
        return {
            modal: null,
            processing: false,
            result: null,
            error: null,
        };
    },
    mounted() {
        this.modal = new Modal(this.$refs.modal);
    },
    beforeUnmount() {
        this.modal?.hide();
    },
    methods: {
        /**
         * Show the dialog and run the query of the given monitor
         * @param {object} monitor Monitor data from the edit form
         * @returns {void}
         */
        run(monitor) {
            this.processing = true;
            this.result = null;
            this.error = null;
            this.modal.show();

            this.$root.getSocket().emit("runSqlQuery", monitor, (res) => {
                this.processing = false;
                if (res.ok) {
                    this.result = res;
                } else {
                    this.error = res.msg;
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.sql-result-table {
    font-size: 0.85rem;
    white-space: nowrap;

    td {
        max-width: 400px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
}

.dark {
    .modal-dialog .form-text,
    .modal-dialog p {
        color: $dark-font-color;
    }

    .sql-result-table {
        --bs-table-bg: transparent;
        --bs-table-color: #{$dark-font-color};
        --bs-table-striped-color: #{$dark-font-color};
        --bs-table-striped-bg: rgba(255, 255, 255, 0.04);
        border-color: $dark-border-color;
    }
}
</style>
