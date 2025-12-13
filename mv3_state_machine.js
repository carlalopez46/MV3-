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

    class ExecutionStateMachine {
        constructor(options = {}) {
            this.storage = options.storage || null;
            this.alarmNamespace = options.alarmNamespace || null;
            this.heartbeatName = options.heartbeatName || 'imacros-execution-heartbeat';
            this.heartbeatMinutes = options.heartbeatMinutes || 0.2;
            this.state = DEFAULT_STATE();
        }

        async hydrate() {
            const stored = await this._read();
            if (stored && stored.phase) {
                this.state = Object.assign(DEFAULT_STATE(), {
                    ...stored,
                    meta: Object.assign({}, stored.meta || {})
                });
            } else {
                this.state = DEFAULT_STATE();
            }
            await this._scheduleHeartbeat();
            return this.snapshot();
        }

        snapshot() {
            return Object.assign({}, this.state, { meta: Object.assign({}, this.state.meta) });
        }

        async transition(phase, meta = {}) {
            this.state = {
                phase,
                meta: Object.assign({}, meta),
                updatedAt: Date.now()
            };
            try {
                await this._persist();
            } catch (error) {
                console.warn('[ExecutionStateMachine] Failed to persist transition:', error);
            }
            await this._scheduleHeartbeat();
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
                        resolve(null);
                        return;
                    }
                    resolve(result && result.executionState ? result.executionState : null);
                });
            });
        }

        async _scheduleHeartbeat() {
            if (!this.alarmNamespace || typeof this.alarmNamespace.create !== 'function') return;
            try {
                this.alarmNamespace.create(this.heartbeatName, {
                    delayInMinutes: this.heartbeatMinutes,
                    periodInMinutes: this.heartbeatMinutes
                });
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                    console.warn('[ExecutionStateMachine] Failed to schedule heartbeat:', chrome.runtime.lastError);
                }
            } catch (error) {
                console.warn('[ExecutionStateMachine] Exception scheduling heartbeat:', error);
            }
        }
    }

    globalScope.ExecutionStateMachine = ExecutionStateMachine;
})(typeof self !== 'undefined' ? self : this);
