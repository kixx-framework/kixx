# Step 3: Page Structure

## Overview

Pages in Kixx applications are the core content units that define what users see and interact with. Each page consists of an HTML template and optional JSON data file. The page structure follows a file-based approach where the directory structure mirrors the URL structure, making it intuitive and easy to manage.

## Page Structure

An example page structure:
```
pages/
├── page.html              # Home page (/)
├── page.json              # Home page data
├── about/
│   ├── page.html          # About page (/about)
│   └── page.json          # About page data
├── products/
│   ├── page.html          # Products listing (/products)
│   ├── page.json          # Products page data
│   └── product-name/
│       ├── page.html      # Product detail (/products/product-name)
│       └── page.json      # Product data
└── admin/
    ├── page.html          # Admin dashboard (/admin)
    └── users/
        ├── page.html      # User management (/admin/users)
        └── user-id/
            ├── page.html  # User detail (/admin/users/user-id)
            └── page.json  # User data
```

### Naming Conventions

- Use lowercase with hyphens for directories
- Use descriptive names that reflect the content
- Keep URLs short and memorable
- Use consistent patterns across similar pages

## Page Types

| Page Type | Description |
|-----------|-------------|
| Static Routing | The URL pathname maps directly to the page filepath |
| Dynamic Routing | The page pathname must be defined in the PageHandler options |

### Static Pages

Pages with fixed content that doesn't change based on user input or database data.

#### Home Page
An example static page.

**pages/page.html** - The main landing page:
```html
<div class="hero-banner">
    <img src="/images/hero.jpg" alt="Welcome to {{ page.title }}">
</div>

<main class="site-width-container">
    <h1>{{ page.title }}</h1>
    
    <section class="hero-content">
        <h2>{{ page.subtitle }}</h2>
        <p>{{ page.description }}</p>
        <div class="hero-actions">
            <a href="/products" class="button button--primary">View Products</a>
            <a href="/about" class="button button--secondary">Learn More</a>
        </div>
    </section>
    
    <section class="featured-content">
        <h2>Featured Items</h2>
        <div class="featured-grid">
            {{#each featuredItems}}
            <div class="featured-item">
                <img src="{{ image }}" alt="{{ title }}">
                <h3>{{ title }}</h3>
                <p>{{ description }}</p>
                <a href="{{ url }}" class="button">Learn More</a>
            </div>
            {{/each}}
        </div>
    </section>
    
    <section class="recent-posts">
        <h2>Latest News</h2>
        {{#each recentPosts}}
        <article class="post-preview">
            <h3><a href="/blog/{{ slug }}">{{ title }}</a></h3>
            <time datetime="{{ publishedAt }}">{{ format_date publishedAt }}</time>
            <p>{{ excerpt }}</p>
        </article>
        {{/each}}
    </section>
</main>
```

**pages/page.json** - Home page data:
```json
{
    "title": "Welcome to MyApp",
    "subtitle": "Building Better Web Applications",
    "description": "A modern hypermedia-driven application built with the Kixx framework.",
    "featuredItems": [
        {
            "title": "Feature One",
            "description": "Description of the first feature",
            "image": "/images/feature-1.jpg",
            "url": "/features/one"
        },
        {
            "title": "Feature Two", 
            "description": "Description of the second feature",
            "image": "/images/feature-2.jpg",
            "url": "/features/two"
        }
    ],
    "recentPosts": [
        {
            "title": "Getting Started with Kixx",
            "slug": "getting-started",
            "excerpt": "Learn how to build your first hypermedia application...",
            "publishedAt": "2024-01-15T10:00:00Z"
        }
    ]
}
```

### Dynamic Pages

Pages that display content based on URL parameters or database data.

#### Product Listing Page
Example dynamic page.

**pages/products/page.html** - Products catalog:
```html
<main class="site-width-container">
    <header class="page-header">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
    </header>
    
    <div class="products-container">
        <aside class="filters">
            <h3>Filter Products</h3>
            <form action="/products" method="GET">
                <div class="filter-group">
                    <label for="category">Category</label>
                    <select name="category" id="category">
                        <option value="">All Categories</option>
                        {{#each categories}}
                        <option value="{{ value }}" {{#if selected}}selected{{/if}}>{{ label }}</option>
                        {{/each}}
                    </select>
                </div>
                
                <div class="filter-group">
                    <label for="price">Price Range</label>
                    <select name="price" id="price">
                        <option value="">Any Price</option>
                        <option value="0-50">Under $50</option>
                        <option value="50-100">$50 - $100</option>
                        <option value="100+">Over $100</option>
                    </select>
                </div>
                
                <button type="submit" class="button">Apply Filters</button>
            </form>
        </aside>
        
        <section class="products-grid">
            {{#each products}}
            <article class="product-card">
                <img src="{{ image }}" alt="{{ name }}">
                <div class="product-info">
                    <h3><a href="/products/{{ slug }}">{{ name }}</a></h3>
                    <p class="price">{{ format_currency price }}</p>
                    <p class="description">{{ description }}</p>
                    <div class="product-actions">
                        <a href="/products/{{ slug }}" class="button">View Details</a>
                        <form action="/cart/add" method="POST" style="display: inline;">
                            <input type="hidden" name="productId" value="{{ id }}">
                            <button type="submit" class="button button--primary">Add to Cart</button>
                        </form>
                    </div>
                </div>
            </article>
            {{/each}}
        </section>
    </div>
    
    {{#if pagination}}
    <nav class="pagination">
        {{#if pagination.prev}}
        <a href="?page={{ pagination.prev }}" class="pagination__prev">← Previous</a>
        {{/if}}
        
        <span class="pagination__current">Page {{ pagination.current }} of {{ pagination.total }}</span>
        
        {{#if pagination.next}}
        <a href="?page={{ pagination.next }}" class="pagination__next">Next →</a>
        {{/if}}
    </nav>
    {{/if}}
</main>
```

#### Product Detail Page
Example dynamic page with dynamic path.

**pages/products/product-name/page.html** - Individual product page:
```html
<main class="site-width-container">
    {{#if product}}
    <article class="product-detail">
        <div class="product-images">
            <img src="{{ product.image }}" alt="{{ product.name }}" class="product-main-image">
            {{#if product.gallery}}
            <div class="product-gallery">
                {{#each product.gallery}}
                <img src="{{ this }}" alt="{{ ../product.name }}" class="product-thumbnail">
                {{/each}}
            </div>
            {{/if}}
        </div>
        
        <div class="product-info">
            <h1>{{ product.name }}</h1>
            <p class="product-price">{{ format_currency product.price }}</p>
            <p class="product-description">{{ product.description }}</p>
            
            {{#if product.specifications}}
            <section class="product-specs">
                <h3>Specifications</h3>
                <dl>
                    {{#each product.specifications}}
                    <dt>{{ @key }}</dt>
                    <dd>{{ this }}</dd>
                    {{/each}}
                </dl>
            </section>
            {{/if}}
            
            <div class="product-actions">
                <form action="/cart/add" method="POST">
                    <input type="hidden" name="productId" value="{{ product.id }}">
                    <div class="quantity-selector">
                        <label for="quantity">Quantity:</label>
                        <select name="quantity" id="quantity">
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                            <option value="5">5</option>
                        </select>
                    </div>
                    <button type="submit" class="button button--primary button--large">Add to Cart</button>
                </form>
                
                <a href="/products" class="button button--secondary">Back to Products</a>
            </div>
        </div>
    </article>
    
    {{#if relatedProducts}}
    <section class="related-products">
        <h2>Related Products</h2>
        <div class="products-grid">
            {{#each relatedProducts}}
            <article class="product-card">
                <img src="{{ image }}" alt="{{ name }}">
                <h3><a href="/products/{{ slug }}">{{ name }}</a></h3>
                <p class="price">{{ format_currency price }}</p>
            </article>
            {{/each}}
        </div>
    </section>
    {{/if}}
    {{else}}
    <div class="error-message">
        <h1>Product Not Found</h1>
        <p>The product you're looking for doesn't exist.</p>
        <a href="/products" class="button">Browse All Products</a>
    </div>
    {{/if}}
</main>
```

### Form Pages

Pages that handle user input and data submission.

#### Contact Form Page

**pages/contact/page.html** - Contact form:
```html
<main class="site-width-container">
    <header class="page-header">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
    </header>
    
    <div class="contact-container">
        <div class="contact-info">
            <h2>Get in Touch</h2>
            {{#if contactInfo.phone}}
            <p><strong>Phone:</strong> <a href="tel:{{ contactInfo.phone.raw }}">{{ contactInfo.phone.formatted }}</a></p>
            {{/if}}
            {{#if contactInfo.email}}
            <p><strong>Email:</strong> <a href="mailto:{{ contactInfo.email }}">{{ contactInfo.email }}</a></p>
            {{/if}}
            {{#if contactInfo.address}}
            <address>
                <strong>Address:</strong><br>
                {{ contactInfo.address.street }}<br>
                {{ contactInfo.address.city }}, {{ contactInfo.address.state }} {{ contactInfo.address.zip }}
            </address>
            {{/if}}
        </div>
        
        <div class="contact-form">
            <h2>Send us a Message</h2>
            
            {{#if success}}
            <div class="success-message">
                <h3>Thank you!</h3>
                <p>Your message has been sent successfully. We'll get back to you soon.</p>
            </div>
            {{else}}
            <form action="/contact" method="POST">
                {{#if error}}
                <div class="error-message">
                    <p>{{ error }}</p>
                </div>
                {{/if}}
                
                <div class="form-row">
                    {{> components/form-field.html 
                        id="firstName" 
                        name="firstName" 
                        label="First Name" 
                        value=formData.firstName 
                        required=true 
                        error=errors.firstName }}
                    
                    {{> components/form-field.html 
                        id="lastName" 
                        name="lastName" 
                        label="Last Name" 
                        value=formData.lastName 
                        required=true 
                        error=errors.lastName }}
                </div>
                
                {{> components/form-field.html 
                    id="email" 
                    name="email" 
                    type="email" 
                    label="Email Address" 
                    value=formData.email 
                    required=true 
                    error=errors.email }}
                
                {{> components/form-field.html 
                    id="subject" 
                    name="subject" 
                    label="Subject" 
                    value=formData.subject 
                    required=true 
                    error=errors.subject }}
                
                {{> components/form-field.html 
                    id="message" 
                    name="message" 
                    type="textarea" 
                    label="Message" 
                    value=formData.message 
                    required=true 
                    rows="5" 
                    error=errors.message }}
                
                <button type="submit" class="button button--primary">Send Message</button>
            </form>
            {{/if}}
        </div>
    </div>
</main>
```

## Page Data Structure

### Data Sources

Page data comes from multiple sources:

1. **Site-wide data** - From `site-page-data.json`
2. **Page-specific data** - From `pages/*/page.json`
3. **Dynamic data** - From request handlers
4. **URL parameters** - From the request URL

### Data Merging
Before being passed into a template, data is merged in this order (later sources override earlier ones):

```javascript
// Data merging order
const pageData = {
    ...sitePageData,        // site-page-data.json
    ...pageSpecificData,    // pages/*/page.json
    ...dynamicData,         // From request handlers
    ...urlParams           // URL parameters
};
```

## Next Steps

After setting up the page structure, proceed to:

- [Step 4: Routing Configuration](../step-4-routing-configuration.md)
- [Step 5: Custom Plugins](../step-5-custom-plugins.md)
- [Step 6: Application Entry Point](../step-6-application-entry-point.md) 