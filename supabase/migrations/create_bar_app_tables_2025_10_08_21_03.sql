-- Create users table
CREATE TABLE IF NOT EXISTS public.users_2025_10_08_21_03 (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create products table
CREATE TABLE IF NOT EXISTS public.products_2025_10_08_21_03 (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create orders table
CREATE TABLE IF NOT EXISTS public.orders_2025_10_08_21_03 (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    user_code TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create missing items table
CREATE TABLE IF NOT EXISTS public.missing_items_2025_10_08_21_03 (
    id BIGSERIAL PRIMARY KEY,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    reason TEXT,
    reported_by TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert sample data
INSERT INTO public.users_2025_10_08_21_03 (name, code) VALUES
('Admin', 'ADMIN001'),
('Jan de Vries', 'JAN001'),
('Marie Janssen', 'MAR001'),
('Piet Bakker', 'PIE001');

INSERT INTO public.products_2025_10_08_21_03 (name, price, stock) VALUES
('Bier', 2.50, 50),
('Wijn', 4.00, 30),
('Frisdrank', 2.00, 40),
('Koffie', 1.50, 25),
('Thee', 1.25, 20),
('Bitterballen', 5.50, 15),
('Kaas', 3.75, 12),
('Nootjes', 2.25, 18);

-- Enable Row Level Security
ALTER TABLE public.users_2025_10_08_21_03 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products_2025_10_08_21_03 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders_2025_10_08_21_03 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missing_items_2025_10_08_21_03 ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (since this is a bar app with simple access control)
CREATE POLICY "Allow all operations on users" ON public.users_2025_10_08_21_03 FOR ALL USING (true);
CREATE POLICY "Allow all operations on products" ON public.products_2025_10_08_21_03 FOR ALL USING (true);
CREATE POLICY "Allow all operations on orders" ON public.orders_2025_10_08_21_03 FOR ALL USING (true);
CREATE POLICY "Allow all operations on missing_items" ON public.missing_items_2025_10_08_21_03 FOR ALL USING (true);