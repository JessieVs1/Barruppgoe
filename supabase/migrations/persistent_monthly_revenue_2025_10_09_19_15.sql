-- First, populate monthly revenue table with existing order data
INSERT INTO public.monthly_revenue_2025_10_09_18_50 (year, month, revenue)
SELECT 
    EXTRACT(YEAR FROM created_at) as year,
    EXTRACT(MONTH FROM created_at) as month,
    SUM(price * quantity) as revenue
FROM public.orders_2025_10_08_21_03
GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at)
ON CONFLICT (year, month) 
DO UPDATE SET 
    revenue = EXCLUDED.revenue,
    updated_at = timezone('utc'::text, now());

-- Update the trigger function to handle both INSERT and DELETE
CREATE OR REPLACE FUNCTION update_monthly_revenue()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle INSERT: Add to monthly revenue
    IF TG_OP = 'INSERT' THEN
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
    
    -- Handle DELETE: We DON'T subtract from monthly revenue to keep historical data
    -- This ensures monthly revenue is preserved even when orders are deleted
    IF TG_OP = 'DELETE' THEN
        -- Do nothing - keep the monthly revenue intact
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recreate triggers for both INSERT and DELETE
DROP TRIGGER IF EXISTS trigger_update_monthly_revenue ON public.orders_2025_10_08_21_03;
CREATE TRIGGER trigger_update_monthly_revenue
    AFTER INSERT ON public.orders_2025_10_08_21_03
    FOR EACH ROW
    EXECUTE FUNCTION update_monthly_revenue();

-- Add a note column to track when revenue was locked
ALTER TABLE public.monthly_revenue_2025_10_09_18_50 
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;

-- Add a comment to explain the purpose
COMMENT ON TABLE public.monthly_revenue_2025_10_09_18_50 IS 'Persistent monthly revenue tracking that preserves historical data even when orders are deleted';