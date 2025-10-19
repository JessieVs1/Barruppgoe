-- Add description column to products table
ALTER TABLE public.products_2025_10_08_21_03 
ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';