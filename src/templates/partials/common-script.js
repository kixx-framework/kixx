// Set up the theme toggle.
(function () {
    'use strict';

    const themeToggles = document.querySelectorAll('[data-js-behavior="theme-toggle"]');
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

    function currentTheme() {
        return document.documentElement.dataset.theme || (systemTheme.matches ? 'dark' : 'light');
    }

    function syncThemeControl() {
        const theme = currentTheme();
        themeToggles.forEach(toggle => {
            toggle.setAttribute('aria-pressed', String(theme === 'dark'));
            // The control names the theme it switches TO, so it reads as an
            // action label rather than a state indicator.
            toggle.querySelector('.theme-toggle__label').textContent = theme === 'dark' ? 'light' : 'dark';
        });
    }

    themeToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            const nextTheme = currentTheme() === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = nextTheme;
            try {
                localStorage.setItem('kixx-theme', nextTheme);
            } catch (_err) {
                document.documentElement.dataset.theme = nextTheme;
            }
            syncThemeControl();
        });
    });

    systemTheme.addEventListener('change', () => {
        if (!document.documentElement.dataset.theme) {
            syncThemeControl();
        }
    });

    syncThemeControl();
}());

// Set up the copy field buttons
(function () {
    'use strict';

    const copyFieldButtons = document.querySelectorAll('[data-js-behavior="copy-field"]');

    copyFieldButtons.forEach((button) => {
        const field = document.getElementById(button.dataset.copyTarget);

        // A copy button with no resolvable target field is a markup bug in
        // whichever page rendered it; skip it instead of throwing so one
        // broken control cannot stop every other copy-field on the page.
        if (!field) {
            return;
        }

        const icon = button.querySelector('.copy-field__icon');
        const status = field.closest('.copy-field').querySelector('.copy-field__status');
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
                    // that replaced the old Material Symbols icon.
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
