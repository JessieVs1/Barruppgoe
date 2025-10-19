-- Add description column to products table
ALTER TABLE public.products_2025_10_08_21_03 
ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

-- Update existing products with descriptions
UPDATE public.products_2025_10_08_21_03 SET description = 'Koud geserveerd bier van het vat' WHERE name = 'Bier';
UPDATE public.products_2025_10_08_21_03 SET description = 'Huiswijn rood of wit' WHERE name = 'Wijn';
UPDATE public.products_2025_10_08_21_03 SET description = 'Koude frisdrank naar keuze' WHERE name = 'Frisdrank';
UPDATE public.products_2025_10_08_21_03 SET description = 'Verse koffie van de machine' WHERE name = 'Koffie';
UPDATE public.products_2025_10_08_21_03 SET description = 'Warme thee verschillende smaken' WHERE name = 'Thee';
UPDATE public.products_2025_10_08_21_03 SET description = 'Warme bitterballen met mosterd' WHERE name = 'Bitterballen';
UPDATE public.products_2025_10_08_21_03 SET description = 'Hollandse kaas met crackers' WHERE name = 'Kaas';
UPDATE public.products_2025_10_08_21_03 SET description = 'Gemengde nootjes gezouten' WHERE name = 'Nootjes';