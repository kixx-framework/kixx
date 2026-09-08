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
