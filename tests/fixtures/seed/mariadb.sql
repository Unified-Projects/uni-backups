-- MariaDB Test Seed Data
-- This file is automatically executed when the mariadb container starts

-- Create test tables
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT,
    quantity INT NOT NULL,
    warehouse VARCHAR(50),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT,
    product_id INT,
    quantity INT NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Insert test products
INSERT INTO products (name, price, category) VALUES
    ('Widget A', 29.99, 'electronics'),
    ('Widget B', 49.99, 'electronics'),
    ('Gadget X', 99.99, 'gadgets'),
    ('Tool Y', 19.99, 'tools'),
    ('Device Z', 149.99, 'electronics');

-- Insert test inventory
INSERT INTO inventory (product_id, quantity, warehouse) VALUES
    (1, 100, 'warehouse-1'),
    (2, 50, 'warehouse-1'),
    (3, 25, 'warehouse-2'),
    (4, 200, 'warehouse-2'),
    (5, 75, 'warehouse-1');

-- Insert test customers
INSERT INTO customers (name, email, phone) VALUES
    ('John Doe', 'john@example.com', '555-0100'),
    ('Jane Smith', 'jane@example.com', '555-0101'),
    ('Bob Wilson', 'bob@example.com', '555-0102');

-- Insert test sales
INSERT INTO sales (customer_id, product_id, quantity, total_price) VALUES
    (1, 1, 2, 59.98),
    (1, 3, 1, 99.99),
    (2, 2, 1, 49.99),
    (3, 4, 5, 99.95),
    (2, 5, 1, 149.99);

-- Create indexes for testing
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_inventory_warehouse ON inventory(warehouse);
CREATE INDEX idx_sales_date ON sales(sale_date);
