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

-- Create monthly revenue tracking table
CREATE TABLE IF NOT EXISTS public.monthly_revenue_2025_10_09_18_50 (
    id BIGSERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(year, month)
);

-- Enable RLS for monthly revenue table
ALTER TABLE public.monthly_revenue_2025_10_09_18_50 ENABLE ROW LEVEL SECURITY;

-- Create policy for monthly revenue table
CREATE POLICY "Allow all operations on monthly_revenue" ON public.monthly_revenue_2025_10_09_18_50 FOR ALL USING (true);

-- Create function to update monthly revenue
CREATE OR REPLACE FUNCTION update_monthly_revenue()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update monthly revenue when order is inserted
    IF TG_OP = 'INSERT' then
        INSERT INTO public.monthly_revenue_2025_10_09_18_50 (year, month, revenue)
        VALUES (
            EXTRACT(YEAR FROM NEW.created_at),
            EXTRACT(MONTH FROM NEW.created_at),
            NEW.price * NEW.quantity
        )
        ON CONFLICT (year, month)
        DO UPDATE SET 
            revenue = monthly_revenue_2025_10_09_18_50.revenue + (NEW.price * NEW.quantity),
            updated_at = timezone('utc'::text, now());
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update monthly revenue
DROP TRIGGER IF EXISTS trigger_update_monthly_revenue ON public.orders_2025_10_08_21_03;
CREATE TRIGGER trigger_update_monthly_revenue
    AFTER INSERT ON public.orders_2025_10_08_21_03
    FOR EACH ROW
    EXECUTE FUNCTION update_monthly_revenue();