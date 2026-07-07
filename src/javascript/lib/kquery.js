export default function kQuery(selector) {
    if (!new.target) {
        return new kQuery(selector);
    }

    if (Array.isArray(selector)) {
        this.nodeList = selector;
        return this;
    }

    if (selector instanceof NodeList) {
        this.nodeList = Array.from(selector);
        return this;
    }

    this.nodeList = [];

    // Handle falsy values by returning an empty instance.
    if (!selector) {
        return this;
    }

    // Detect a DOMElement
    if (selector.nodeType) {
        this.nodeList.push(selector);
        return this;
    }

    const nodeList = document.querySelectorAll(selector);
    this.nodeList = Array.from(nodeList);
}

Object.assign(kQuery.prototype, {
    query(selector) {
        const NextKQuery = this.constructor;
        const results = this.nodeList.length ? this.nodeList[0].querySelectorAll(selector) : null;
        return new NextKQuery(results);
    },
    first() {
        const NextKQuery = this.constructor;
        return new NextKQuery(this.nodeList[0]);
    },
    closest(selector) {
        const NextKQuery = this.constructor;
        const node = this.nodeList.length ? this.nodeList[0].closest(selector) : null;
        return new NextKQuery(node);
    },
    forEach(fn) {
        const NextKQuery = this.constructor;
        this.nodeList.forEach((node) => {
            fn(new NextKQuery(node));
        });
        return this;
    },
    getAttribute(key) {
        return this.nodeList.length ? this.nodeList[0].getAttribute(key) : null;
    },
    setAttribute(key, val) {
        this.nodeList.forEach((node) => {
            node.setAttribute(key, val);
        });
        return this;
    },
    getData(key) {
        return this.nodeList.length ? this.nodeList[0].dataset[key] : undefined;
    },
    setData(key, val) {
        this.nodeList.forEach((node) => {
            node.dataset[key] = val;
        });
        return this;
    },
    getTextContent() {
        return this.nodeList.length ? this.nodeList[0].textContent : '';
    },
    setTextContent(val) {
        this.nodeList.forEach((node) => {
            node.textContent = val;
        });
        return this;
    },
    on(eventName, handler) {
        this.nodeList.forEach((node) => {
            node.addEventListener(eventName, handler);
        });
        return this;
    },
    off(eventName, handler) {
        this.nodeList.forEach((node) => {
            node.removeEventListener(eventName, handler);
        });
        return this;
    },
});
