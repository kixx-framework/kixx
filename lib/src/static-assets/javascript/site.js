// Set up the theme toggle.
(function () {
    const root = document.documentElement;
    const toggles = document.querySelectorAll('[data-js-behavior="theme-toggle"]');
    const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)');

    function getCurrentColorScheme() {
        return root.dataset.colorScheme || (systemColorScheme.matches ? 'dark' : 'light');
    }

    function syncSchemeControl() {
        const scheme = getCurrentColorScheme();

        toggles.forEach((toggle) => {
            toggle.setAttribute('aria-pressed', String(scheme === 'dark'));

            const label = toggle.querySelector('.theme-toggle__label');

            if (label) {
                // The control names the theme it switches TO, so it reads as an
                // action label rather than a state indicator.
                label.textContent = scheme === 'dark' ? 'light' : 'dark';
            }
        });
    }

    toggles.forEach((toggle) => {
        toggle.addEventListener('click', () => {
            const nextScheme = getCurrentColorScheme() === 'dark' ? 'light' : 'dark';

            root.dataset.colorScheme = nextScheme;

            // Storage can be unavailable or full. The theme still applies for
            // this page view; only the memory of it across page loads is lost,
            // so a failed write must not stop the control from updating.
            try {
                localStorage.setItem(window.COLOR_SCHEME_STORAGE_KEY, nextScheme);
            } catch (_err) {
                // Intentionally ignored.
            }

            syncSchemeControl();
        });
    });

    systemColorScheme.addEventListener('change', () => {
        if (!root.dataset.colorScheme) {
            syncSchemeControl();
        }
    });

    syncSchemeControl();
}());

// Set up the clipboard copy field buttons
(function () {
    document.querySelectorAll('[data-js-behavior="copy-field"]').forEach((button) => {
        const fieldId = button.dataset.copyTarget;

        // A copy button with no resolvable target field is a markup bug in
        // whichever page rendered it; skip it instead of throwing so one
        // broken control cannot stop every other copy-field on the page.
        if (!fieldId) {
            // eslint-disable-next-line no-console
            console.warn('expected button to have data-copy-target', button);
            return;
        }

        const field = document.getElementById(fieldId);

        if (!field) {
            // eslint-disable-next-line no-console
            console.warn('expected a copy field with id', fieldId);
            return;
        }

        const container = button.closest('.copy-field');
        const icon = button.querySelector('.copy-field__icon');
        const status = container ? container.querySelector('.copy-field__status') : null;
        const defaultIconName = icon ? icon.textContent : null;

        let resetTimeoutId = null;

        function setStatus(message) {
            if (status) {
                status.textContent = message;
            }
        }

        function resetIcon() {
            if (icon && defaultIconName) {
                icon.textContent = defaultIconName;
            }
        }

        field.addEventListener('click', () => {
            field.select();
        });

        button.addEventListener('click', async () => {
            field.select();
            clearTimeout(resetTimeoutId);

            // Clipboard writes require a secure context and user permission;
            // fall back to "select and let the user copy manually" whenever
            // the API is missing or the browser denies the write.
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
                setStatus('Press Ctrl+C or Cmd+C to copy.');
                return;
            }

            try {
                await navigator.clipboard.writeText(field.value);
                setStatus('Copied.');

                if (icon) {
                    // Plain success mark, consistent with the "copy" text token
                    icon.textContent = '✓';
                }

                resetTimeoutId = setTimeout(() => {
                    setStatus('');
                    resetIcon();
                }, 2000);
            } catch (_err) {
                setStatus('Press Ctrl+C or Cmd+C to copy.');
            }
        });
    });
}());

// Set up single-file replacement uploads on the admin file detail page.
(function () {
    function parseErrorMessage(xhr) {
        try {
            const body = JSON.parse(xhr.responseText);
            return body && body.error && body.error.message;
        } catch (_err) {
            return null;
        }
    }

    document.querySelectorAll('[data-js-behavior="file-replace"]').forEach((container) => {
        const input = container.querySelector('[data-replace-input]');
        const progressWrap = container.querySelector('[data-replace-progress]');
        const progressBar = container.querySelector('[data-replace-progress-bar]');
        const status = container.querySelector('[data-replace-status]');
        const replaceUrl = container.dataset.replaceUrl;
        const csrfToken = container.dataset.csrfToken;
        const isPublished = container.dataset.isPublished === 'true';

        // A missing hook is a markup bug in this one container; skip it instead
        // of throwing so it cannot take down other behaviors on the page.
        if (!input || !replaceUrl || !csrfToken) {
            // eslint-disable-next-line no-console
            console.warn('file-replace is missing required markup', container);
            return;
        }

        function setStatus(message) {
            if (status) {
                status.textContent = message;
            }
        }

        function uploadReplacement(file) {
            const xhr = new XMLHttpRequest();

            if (progressWrap) {
                progressWrap.hidden = false;
                if (progressBar) {
                    progressBar.value = 0;
                }
            }
            setStatus('Uploading…');

            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable && progressBar) {
                    progressBar.value = Math.round((event.loaded / event.total) * 100);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    setStatus('Replacement uploaded. Reloading…');
                    window.location.reload();
                    return;
                }
                if (progressWrap) {
                    progressWrap.hidden = true;
                }
                setStatus(parseErrorMessage(xhr) || 'The replacement upload failed.');
            });

            xhr.addEventListener('error', () => {
                if (progressWrap) {
                    progressWrap.hidden = true;
                }
                setStatus('The replacement upload failed. Check your connection and try again.');
            });

            xhr.addEventListener('abort', () => {
                if (progressWrap) {
                    progressWrap.hidden = true;
                }
                setStatus('Replacement canceled.');
            });

            xhr.open('POST', replaceUrl);
            xhr.setRequestHeader('x-kixx-csrf-token', csrfToken);
            xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
            xhr.setRequestHeader('x-file-size', String(file.size));
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
        }

        input.addEventListener('change', () => {
            const file = input.files && input.files[0];

            if (!file) {
                return;
            }

            // Replacing published bytes goes live immediately at the file's
            // existing public URL, so confirm before sending it. A canceled
            // confirmation clears the picked file rather than leaving a stale
            // selection the operator did not mean to upload.
            if (isPublished && !window.confirm('Replace the published file? The new bytes go live immediately at the same URL.')) {
                input.value = '';
                return;
            }

            uploadReplacement(file);
        });
    });
}());

// Set up the independent batch upload queue on the admin "Upload files" page.
(function () {
    const MAX_CONCURRENT_UPLOADS = 3;

    let rowSequence = 0;

    function parseJsonBody(xhr) {
        try {
            return JSON.parse(xhr.responseText);
        } catch (_err) {
            return null;
        }
    }

    function parseErrorMessage(xhr) {
        const body = parseJsonBody(xhr);
        return body && body.error && body.error.message;
    }

    // Builds one row's DOM, XHR transport, and metadata/publish state machine.
    // Kept as a single closure per row so upload progress, retry, and the
    // metadata form below it can share state without reaching into other rows.
    function createUploadRow(options) {
        const {
            file,
            rowTemplate,
            list,
            uploadUrl,
            csrfField,
            csrfToken,
            maxUploadBytes,
            onRetry,
        } = options;

        const node = rowTemplate.content.firstElementChild.cloneNode(true);
        list.appendChild(node);

        const statusEl = node.querySelector('[data-row-status]');
        const filenameEl = node.querySelector('[data-row-filename]');
        const progressWrap = node.querySelector('[data-row-progress]');
        const progressBar = node.querySelector('[data-row-progress-bar]');
        const errorEl = node.querySelector('[data-row-error]');
        const titleInput = node.querySelector('[data-row-title]');
        const descriptionInput = node.querySelector('[data-row-description]');
        const cancelButton = node.querySelector('[data-row-cancel]');
        const retryButton = node.querySelector('[data-row-retry]');
        const saveButton = node.querySelector('[data-row-save]');
        const publishButton = node.querySelector('[data-row-publish]');
        const saveStatusEl = node.querySelector('[data-row-save-status]');

        filenameEl.textContent = file.name;

        // Every row repeats the same labels and buttons, so give each row its
        // own ids: labels name their fields, and the filename describes the
        // row's progress bar and buttons for screen reader users.
        rowSequence += 1;
        const rowId = 'file-upload-row-' + rowSequence;
        filenameEl.id = rowId + '-filename';
        titleInput.id = rowId + '-title';
        descriptionInput.id = rowId + '-description';
        node.querySelector('[data-row-title-label]').htmlFor = titleInput.id;
        node.querySelector('[data-row-description-label]').htmlFor = descriptionInput.id;
        [ progressBar, cancelButton, retryButton, saveButton, publishButton ].forEach((element) => {
            element.setAttribute('aria-describedby', filenameEl.id);
        });
        progressBar.setAttribute('aria-label', 'Upload progress');

        // Upload state ('queued' | 'uploading' | 'succeeded' | 'failed' |
        // 'canceled') is tracked separately from metadata dirty/saving state and
        // from publication state, since all three change independently once the
        // upload has succeeded.
        let state = 'queued';
        let activeXhr = null;
        let fileLinks = null;
        let isPublished = false;
        let metadataDirty = false;
        let metadataSaving = false;

        const controller = {
            isQueued() {
                return state === 'queued';
            },
            hasUnfinishedWork() {
                return state === 'queued' || state === 'uploading' || metadataDirty || metadataSaving;
            },
            start(onSettled) {
                startUpload(onSettled);
            },
            cancel() {
                cancelUpload();
            },
            retry() {
                retryUpload();
            },
        };

        function setStatus(text) {
            if (statusEl) {
                statusEl.textContent = text;
            }
        }

        function setError(message) {
            if (errorEl) {
                errorEl.textContent = message || '';
                errorEl.hidden = !message;
            }
        }

        function failUpload(message, onSettled) {
            state = 'failed';
            activeXhr = null;
            setStatus('Failed');
            setError(message);
            if (progressWrap) {
                progressWrap.hidden = true;
            }
            cancelButton.hidden = true;
            retryButton.hidden = false;
            onSettled();
        }

        function succeedUpload(xhr, onSettled) {
            const body = parseJsonBody(xhr);

            activeXhr = null;

            if (!body || !body.file || !body.links) {
                failUpload('The server response could not be read.', onSettled);
                return;
            }

            state = 'succeeded';
            fileLinks = body.links;
            isPublished = Boolean(body.file.isPublished);
            setStatus('Uploaded');
            setError(null);
            if (progressWrap) {
                progressWrap.hidden = true;
            }
            cancelButton.hidden = true;
            retryButton.hidden = true;
            saveButton.disabled = false;
            publishButton.disabled = false;
            publishButton.textContent = isPublished ? 'Unpublish' : 'Publish';
            onSettled();
        }

        function startUpload(onSettled) {
            state = 'uploading';
            setStatus('Uploading…');
            setError(null);
            cancelButton.hidden = false;
            retryButton.hidden = true;
            if (progressWrap) {
                progressWrap.hidden = false;
                if (progressBar) {
                    progressBar.value = 0;
                }
            }

            if (maxUploadBytes && file.size > maxUploadBytes) {
                failUpload('This file is larger than the allowed upload limit.', onSettled);
                return;
            }

            const xhr = new XMLHttpRequest();
            activeXhr = xhr;

            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable && progressBar) {
                    progressBar.value = Math.round((event.loaded / event.total) * 100);
                }
            });

            xhr.addEventListener('load', () => {
                if (state === 'canceled') {
                    onSettled();
                    return;
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    succeedUpload(xhr, onSettled);
                    return;
                }
                failUpload(parseErrorMessage(xhr) || 'The upload failed.', onSettled);
            });

            xhr.addEventListener('error', () => {
                if (state !== 'canceled') {
                    failUpload('The upload failed. Check your connection and try again.', onSettled);
                }
            });

            xhr.addEventListener('abort', () => {
                activeXhr = null;
                state = 'canceled';
                setStatus('Canceled');
                if (progressWrap) {
                    progressWrap.hidden = true;
                }
                cancelButton.hidden = true;
                retryButton.hidden = false;
                onSettled();
            });

            xhr.open('POST', uploadUrl);
            xhr.setRequestHeader('x-kixx-csrf-token', csrfToken);
            xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
            xhr.setRequestHeader('x-file-size', String(file.size));
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
        }

        // Cancel removes queued work before it starts, or aborts the active
        // request; either way the row and its typed metadata stay on screen so
        // the operator can retry from the same row.
        function cancelUpload() {
            if (state === 'queued') {
                state = 'canceled';
                setStatus('Canceled');
                cancelButton.hidden = true;
                retryButton.hidden = false;
                return;
            }
            if (state === 'uploading' && activeXhr) {
                activeXhr.abort();
            }
        }

        // Retry always starts from byte zero with the same retained File object;
        // there is no idempotency key, so an uncertain prior outcome can leave a
        // duplicate file behind. That tradeoff is accepted by the plan.
        function retryUpload() {
            if (state !== 'failed' && state !== 'canceled') {
                return;
            }
            state = 'queued';
            setStatus('Queued');
            setError(null);
            retryButton.hidden = true;
            cancelButton.hidden = false;
            onRetry(controller);
        }

        function saveMetadata() {
            if (!fileLinks || metadataSaving) {
                return;
            }

            // Snapshot what this request is submitting. If newer text arrives
            // while the request is in flight, the response must not mark that
            // newer, unsent text as saved.
            const savedTitle = titleInput.value;
            const savedDescription = descriptionInput.value;

            metadataSaving = true;
            saveButton.disabled = true;
            if (saveStatusEl) {
                saveStatusEl.textContent = 'Saving…';
            }

            const body = new URLSearchParams();
            body.set(csrfField, csrfToken);
            body.set('title', savedTitle);
            body.set('description', savedDescription);

            fetch(fileLinks.metadata, {
                method: 'POST',
                headers: { 'kixx-partial': 'row' },
                body,
            }).then((response) => {
                return response.json().then((data) => ({ ok: response.ok, data }));
            }).then(({ ok, data }) => {
                metadataSaving = false;
                saveButton.disabled = false;

                if (!ok) {
                    if (saveStatusEl) {
                        saveStatusEl.textContent = (data.error && data.error.message) || 'Could not save metadata.';
                    }
                    return;
                }

                if (saveStatusEl) {
                    saveStatusEl.textContent = 'Saved.';
                }

                if (titleInput.value === savedTitle && descriptionInput.value === savedDescription) {
                    metadataDirty = false;
                }
            }).catch(() => {
                metadataSaving = false;
                saveButton.disabled = false;
                if (saveStatusEl) {
                    saveStatusEl.textContent = 'Could not save metadata. Check your connection.';
                }
            });
        }

        function togglePublish() {
            if (!fileLinks) {
                return;
            }

            const url = isPublished ? fileLinks.unpublish : fileLinks.publish;
            const body = new URLSearchParams();
            body.set(csrfField, csrfToken);

            publishButton.disabled = true;

            fetch(url, {
                method: 'POST',
                headers: { 'kixx-partial': 'row' },
                body,
            }).then((response) => {
                return response.json().then((data) => ({ ok: response.ok, data }));
            }).then(({ ok, data }) => {
                publishButton.disabled = false;
                if (ok && data.file) {
                    isPublished = Boolean(data.file.isPublished);
                    publishButton.textContent = isPublished ? 'Unpublish' : 'Publish';
                    return;
                }
                // An expired session or form lands here; say so on this row
                // rather than silently re-enabling the button.
                if (saveStatusEl) {
                    saveStatusEl.textContent = (data.error && data.error.message) || 'Could not change publication.';
                }
            }).catch(() => {
                publishButton.disabled = false;
                if (saveStatusEl) {
                    saveStatusEl.textContent = 'Could not change publication. Check your connection.';
                }
            });
        }

        cancelButton.addEventListener('click', () => controller.cancel());
        retryButton.addEventListener('click', () => controller.retry());
        saveButton.addEventListener('click', () => saveMetadata());
        publishButton.addEventListener('click', () => togglePublish());
        titleInput.addEventListener('input', () => {
            metadataDirty = true;
        });
        descriptionInput.addEventListener('input', () => {
            metadataDirty = true;
        });

        return controller;
    }

    document.querySelectorAll('[data-js-behavior="file-upload-queue"]').forEach((container) => {
        const input = container.querySelector('[data-upload-input]');
        const list = container.querySelector('[data-upload-list]');
        const rowTemplate = document.querySelector('[data-upload-row-template]');
        const uploadUrl = container.dataset.uploadUrl;
        const csrfField = container.dataset.csrfField;
        const csrfToken = container.dataset.csrfToken;
        const maxUploadBytes = Number(container.dataset.maxUploadBytes) || null;

        if (!input || !list || !rowTemplate || !uploadUrl || !csrfField || !csrfToken) {
            // eslint-disable-next-line no-console
            console.warn('file-upload-queue is missing required markup', container);
            return;
        }

        const rows = [];
        const pending = [];
        let activeCount = 0;

        function handleRowSettled() {
            activeCount -= 1;
            startNext();
        }

        function startNext() {
            while (activeCount < MAX_CONCURRENT_UPLOADS && pending.length > 0) {
                const row = pending.shift();

                // Cancel leaves a queued row's entry in place, and a retry adds
                // another, so a row can appear twice. Start only rows still
                // waiting; a stale entry for a started or canceled row is skipped.
                if (!row.isQueued()) {
                    continue;
                }

                activeCount += 1;
                row.start(handleRowSettled);
            }
        }

        function enqueue(row) {
            pending.push(row);
            startNext();
        }

        // Warn on navigation only while a row still has an active or queued
        // upload, or metadata typed but not yet saved. Once every row settles,
        // no listener blocks navigation — there is no background persistence
        // once the page unloads.
        window.addEventListener('beforeunload', (event) => {
            if (rows.some((row) => row.hasUnfinishedWork())) {
                event.preventDefault();
                event.returnValue = '';
            }
        });

        input.addEventListener('change', () => {
            Array.from(input.files || []).forEach((file) => {
                const row = createUploadRow({
                    file,
                    rowTemplate,
                    list,
                    uploadUrl,
                    csrfField,
                    csrfToken,
                    maxUploadBytes,
                    onRetry: enqueue,
                });
                rows.push(row);
                enqueue(row);
            });
            // Clears the picked-file list so selecting the same file again after
            // it finishes (or fails permanently) starts a fresh row.
            input.value = '';
        });
    });
}());
