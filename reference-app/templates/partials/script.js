(function () {
    'use strict';

    eachBehavior('toggle-schedule-day', (toggle) => {
        const props = toggle.getProps();
        const daySection = $(props.target);

        toggle.on('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggle.siblings().removeClass('active');
            toggle.toggleClass('active');
            daySection.siblings().removeClass('active');
            daySection.toggleClass('active');
        });
    });

    eachBehavior('menu-toggle', (menuToggle) => {
        const props = menuToggle.getProps();
        const menu = $(props.target);

        // Toggle the menu when the toggle is clicked.
        menuToggle.on('click', (event) => {
            event.stopPropagation();
            menu.toggleClass('active');
        });

        // Close the menu when clicking outside of it.
        document.body.addEventListener('click', (event) => {
            if (!menuToggle.contains(event.target) && !menu.contains(event.target)) {
                menu.removeClass('active');
            }
        }, true); // Use the capture phase to ensure the event is handled before anything else.
    });

    eachBehavior('sub-menu-toggle', (menuToggle) => {
        const menu = menuToggle.parent();

        menuToggle.on('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            menu.siblings().removeClass('active');
            menu.toggleClass('active');
        });

        // Close the menu when clicking outside of it.
        document.body.addEventListener('click', (event) => {
            if (!menuToggle.contains(event.target) && !menu.contains(event.target)) {
                menu.removeClass('active');
            }
        }, true); // Use the capture phase to ensure the event is handled before anything else.
    });

    function eachBehavior(behavior, callback) {
        $(`[data-js-behave="${ behavior }"]`).each(callback);
    }

    function $(selector) {
        let list;
        if (typeof selector === 'string') {
            list = document.querySelectorAll(selector);
        } else if (Array.isArray(selector)) {
            list = selector;
        } else {
            list = [ selector ];
        }

        return {
            each(callback) {
                for (const item of list) {
                    callback($([ item ]));
                }
            },
            getProps() {
                const element = list[0];
                const propsJson = element.dataset.jsProps;
                return propsJson ? JSON.parse(propsJson) : {};
            },
            contains(element) {
                for (const item of list) {
                    if (item.contains(element)) {
                        return true;
                    }
                }
                return false;
            },
            on(eventName, callback) {
                for (const item of list) {
                    item.addEventListener(eventName, callback);
                }
                return this;
            },
            parent() {
                return $(list[0].parentElement);
            },
            siblings() {
                const allChildren = list[0].parentElement.children;
                const siblings = [];
                for (const child of allChildren) {
                    if (child !== list[0]) {
                        siblings.push(child);
                    }
                }
                return $(siblings);
            },
            toggleClass(className) {
                for (const item of list) {
                    item.classList.toggle(className);
                }
                return this;
            },
            removeClass(className) {
                for (const item of list) {
                    item.classList.remove(className);
                }
                return this;
            },
        };
    }

}());
