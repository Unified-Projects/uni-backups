-- PostgreSQL Test Seed Data
-- This file is automatically executed when the postgres container starts

-- Create test tables with various data types
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data JSONB
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    stock INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test users
INSERT INTO users (username, email, data) VALUES
    ('alice', 'alice@example.com', '{"role": "admin", "verified": true, "preferences": {"theme": "dark"}}'),
    ('bob', 'bob@example.com', '{"role": "user", "verified": true, "preferences": {"theme": "light"}}'),
    ('charlie', 'charlie@example.com', '{"role": "user", "verified": false, "preferences": {"theme": "auto"}}')
ON CONFLICT (username) DO NOTHING;

-- Insert test orders
INSERT INTO orders (user_id, amount, status) VALUES
    (1, 99.99, 'completed'),
    (1, 150.00, 'pending'),
    (2, 75.50, 'completed'),
    (3, 200.00, 'cancelled'),
    (2, 45.00, 'completed');

-- Insert test products
INSERT INTO products (name, description, price, stock) VALUES
    ('Widget A', 'A high-quality widget', 29.99, 100),
    ('Widget B', 'An even better widget', 49.99, 50),
    ('Gadget X', 'Revolutionary gadget', 99.99, 25),
    ('Tool Y', 'Essential tool', 19.99, 200);

-- Create a view for verification
CREATE OR REPLACE VIEW test_verification AS
SELECT
    (SELECT COUNT(*) FROM users) as user_count,
    (SELECT COUNT(*) FROM orders) as order_count,
    (SELECT COUNT(*) FROM products) as product_count,
    (SELECT SUM(amount) FROM orders WHERE status = 'completed') as total_completed_amount;

-- Create an index for testing
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
