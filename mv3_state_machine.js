/*
 * Execution State Machine for MV3 Service Worker
 * Persists player/recorder/editor lifecycle state and refreshes storage via heartbeat.
 */
(function (globalScope) {
    const DEFAULT_STATE = () => ({
        phase: 'idle',
        meta: {},
        updatedAt: Date.now()
    });

    /**
     * ExecutionStateMachine persists and manages lifecycle phases (idle/playing/editing/recording)
     * for the MV3 service worker, with periodic heartbeat persistence to tolerate restarts.
     *
     * @param {Object} options
     * @param {chrome.storage.StorageArea} [options.storage] - Storage area for state persistence.
     * @param {chrome.alarms.AlarmNamespace} [options.alarmNamespace] - Alarms API for heartbeats.
     * @param {string} [options.heartbeatName] - Alarm name used for heartbeat scheduling.
     * @param {number} [options.heartbeatMinutes] - Heartbeat interval (minutes).
     */
    class ExecutionStateMachine {
        constructor(options = {}) {
            this.storage = options.storage || null;
            this.alarmNamespace = options.alarmNamespace || null;
            this.heartbeatName = options.heartbeatName || 'imacros-execution-heartbeat';
            this.heartbeatMinutes = options.heartbeatMinutes || 1; // Chrome clamps MV3 alarm intervals below 1 minute up to 1 minute (effective min: 1)
            this.state = DEFAULT_STATE();
        }

        async hydrate() {
            const stored = await this._read();
            if (stored && stored.phase) {
                this.state = {
                    ...DEFAULT_STATE(),
                    ...stored,
                    meta: { ...(stored.meta || {}) }
                };
            } else {
                this.state = DEFAULT_STATE();
            }
            try {
                await this._scheduleHeartbeat();
            } catch (error) {
                console.warn('[ExecutionStateMachine] Failed to schedule heartbeat on hydrate:', error);
            }
            return this.snapshot();
        }

        /**
         * Returns a deep copy of the current state to prevent callers from mutating internal metadata.
         */
        snapshot() {
            if (typeof structuredClone === 'function') {
                return structuredClone(this.state);
            }
            // Fallback for environments without structuredClone
            return JSON.parse(JSON.stringify(this.state));
        }

        async transition(phase, meta = {}) {
            this.state = {
                phase,
                meta: Object.assign({}, meta),
                updatedAt: Date.now()
            };
            let persisted = true;
            try {
                await this._persist();
            } catch (error) {
                console.warn('[ExecutionStateMachine] Failed to persist transition:', error);
                persisted = false;
            }
            if (persisted) {
                try {
                    await this._scheduleHeartbeat();
                } catch (error) {
                    console.warn('[ExecutionStateMachine] Failed to schedule heartbeat:', error);
                }
            }
            return this.snapshot();
        }

        async handleAlarm(alarm) {
            if (!alarm || alarm.name !== this.heartbeatName) return;
            try {
                await this._persist();
            } catch (error) {
                console.warn('[ExecutionStateMachine] Heartbeat persistence failed:', error);
            }
        }

        async _persist() {
            if (!this.storage || typeof this.storage.set !== 'function') return;
            await new Promise((resolve, reject) => {
                this.storage.set({ executionState: this.state }, () => {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                        return;
                    }
                    resolve();
                });
            });
        }

        async _read() {
            if (!this.storage || typeof this.storage.get !== 'function') return null;
            return await new Promise((resolve) => {
                this.storage.get(['executionState'], (result) => {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                        console.warn('[ExecutionStateMachine] Failed to read execution state:', chrome.runtime.lastError);
                        resolve(null);
                        return;
                    }
                    resolve(result && result.executionState ? result.executionState : null);
                });
            });
        }

        async _scheduleHeartbeat() {
            if (!this.alarmNamespace || typeof this.alarmNamespace.create !== 'function') return;
            // In Chrome MV3, chrome.alarms.create returns a Promise when called without a callback (other browsers may differ).
            await this.alarmNamespace.create(this.heartbeatName, {
                delayInMinutes: this.heartbeatMinutes,
                periodInMinutes: this.heartbeatMinutes
            });
        }
    }

    globalScope.ExecutionStateMachine = ExecutionStateMachine;
})(typeof self !== 'undefined' ? self : this);