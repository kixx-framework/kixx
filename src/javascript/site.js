import kQuery from './lib/kquery.js';

// Set up the theme toggle.
(function () {
    const root = kQuery(document.documentElement);
    const toggles = kQuery('[data-js-behavior="theme-toggle"]');
    const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)');

    function getCurrentColorScheme() {
        return root.getData('colorScheme') || (systemColorScheme.matches ? 'dark' : 'light');
    }

    function syncSchemeControl() {
        const scheme = getCurrentColorScheme();

        toggles.forEach((toggle) => {
            toggle
                .setAttribute('aria-pressed', String(scheme === 'dark'))
                .query('.theme-toggle__label')
                // The control names the theme it switches TO, so it reads as an
                // action label rather than a state indicator.
                .setTextContent(scheme === 'dark' ? 'light' : 'dark');
        });
    }

    toggles.on('click', () => {
        const nextScheme = getCurrentColorScheme() === 'dark' ? 'light' : 'dark';
        root.setData('colorScheme', nextScheme);
        localStorage.setItem(window.COLOR_SCHEME_STORAGE_KEY, nextScheme);
        syncSchemeControl();
    });

    systemColorScheme.addEventListener('change', () => {
        if (!root.getData('colorScheme')) {
            syncSchemeControl();
        }
    });

    syncSchemeControl();
}());

// Set up the clipboard copy field buttons
(function () {
    kQuery('[data-js-behavior="copy-field"]').forEach((button) => {
        const fieldId = button.getData('copyTarget');
        // A copy button with no resolvable target field is a markup bug in
        // whichever page rendered it; skip it instead of throwing so one
        // broken control cannot stop every other copy-field on the page.
        if (!fieldId) {
            // eslint-disable-next-line no-console
            console.warn('expected button to have data-copy-target', button.nodeList[0]);
            return;
        }

        const field = kQuery(`#${ fieldId }`);
        if (!field) {
            // eslint-disable-next-line no-console
            console.warn('expected a copy field with id', fieldId);
            return;
        }

        const icon = button.query('.copy-field__icon');
        const status = field.closest('.copy-field').query('.copy-field__status');
        const defaultIconName = icon.getTextContent() || null;

        let resetTimeoutId = null;

        function setStatus(message) {
            status.setTextContent(message);
        }

        function resetIcon() {
            if (defaultIconName) {
                icon.setTextContent(defaultIconName);
            }
        }

        field.on('click', () => {
            field.select();
        });

        button.on('click', async () => {
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
