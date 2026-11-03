import React, { useState, useEffect } from 'react';
import { supabase as realSupabase } from '@/integrations/supabase/client';
import { createSandboxClient, loadSandboxStore } from '@/lib/sandboxClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Plus, Minus, ShoppingCart, User, Package, BarChart3, AlertTriangle, ArrowUp, Search, Filter, Menu, X, Receipt, Download, Lock, Clock, KeyRound, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ---------- Testfase ----------
// Alle database-aanroepen in deze pagina lopen via `supabase`. Normaal is
// dat de echte database; tijdens de testfase wijst `activeClient` naar een
// kopie in het geheugen (zie src/lib/sandboxClient.ts), zodat er niets in
// de echte data wordt aangepast.
let activeClient: any = realSupabase;
const supabase = {
  from: (table: string) => activeClient.from(table),
  rpc: (fn: string, args?: Record<string, unknown>) => activeClient.rpc(fn, args),
} as unknown as typeof realSupabase;

// Tijdens de testfase kan iedereen die deze code kent inloggen als
// testgebruiker en de hele bestelflow doorlopen, zonder echte data aan te raken.
const TEST_USER_CODE = 'TEST';

// ---------- Wekelijkse slotcode (verandert elke donderdag) ----------
// De code is volledig voorspelbaar uit de datum (geen database nodig):
// iedereen die tussen donderdag en de volgende woensdag een bestelling
// plaatst, krijgt dezelfde code te zien; zodra het weer donderdag wordt,
// verandert de code automatisch.

/** Middernacht van de meest recente donderdag (vandaag telt mee als het al donderdag is). */
function getMostRecentThursday(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = zondag ... 4 = donderdag ... 6 = zaterdag
  const diff = (day - 4 + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Kleine, deterministische pseudo-random generator op basis van een tekst-seed. */
function seededRandom(seedStr: string): () => number {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  let seed = hash >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** De 4-cijferige code voor de huidige week (donderdag t/m woensdag). */
function getWeeklyLockCode(date: Date = new Date()): string {
  const thursday = getMostRecentThursday(date);
  const seed = thursday.toISOString().slice(0, 10); // bv. "2026-09-17"
  const rand = seededRandom(seed);
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += Math.floor(rand() * 10);
  }
  return code;
}

interface User {
  id: number;
  name: string;
  code: string;
  status?: 'pending' | 'approved';
}

interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  description?: string;
}

interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
}

interface Order {
  id: number;
  name: string;
  quantity: number;
  price: number;
  user_code: string;
  created_at: string;
  settlement_id?: number | null;
}

interface AdminCode {
  id: number;
  name: string;
  code: string;
  permissions?: string[];
  created_at: string;
}

// Onderdelen van Beheer waarvoor de hoofdbeheerder per beheerder kan
// instellen of die erbij mag.
const ADMIN_PERMISSIONS = [
  { key: 'users', label: 'Gebruikersbeheer' },
  { key: 'products', label: 'Voorraadbeheer' },
  { key: 'orders', label: 'Bestelgeschiedenis' },
  { key: 'revenue', label: 'Omzet' },
  { key: 'missing', label: 'Verdwenen goederen' },
  { key: 'settlements', label: 'Tikkies' },
  { key: 'settings', label: 'Onderhoudsmodus & slotcode-schakelaar' },
] as const;
const ALL_PERMISSIONS: string[] = ADMIN_PERMISSIONS.map(p => p.key);

interface Settlement {
  id: number;
  created_at: string;
  due_at: string;
}

interface SettlementItem {
  id: number;
  settlement_id: number;
  user_code: string;
  user_name: string;
  amount: number;
  paid: boolean;
  paid_at: string | null;
}

// Hoofdbeheerder: deze code blijft altijd werken en kan als enige
// extra beheercodes aanmaken of verwijderen.
const MAIN_ADMIN_CODE = 'BHV123';

interface MissingItem {
  id: number;
  product_name: string;
  quantity: number;
  reason: string;
  reported_by: string;
  created_at: string;
}

interface MonthlyRevenue {
  id: number;
  year: number;
  month: number;
  revenue: number;
  created_at: string;
  updated_at: string;
}

const Index = () => {
  const [currentScreen, setCurrentScreen] = useState<'start' | 'order' | 'admin'>('start');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [missingItems, setMissingItems] = useState<MissingItem[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([]);
  const [adminSection, setAdminSection] = useState<string>('');
  const [showConfirmOrder, setShowConfirmOrder] = useState(false);
  const [showLockCodeDialog, setShowLockCodeDialog] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('We voeren momenteel onderhoud uit aan de app. Bestellen kan gewoon doorgaan!');
  const [lockCodeEnabled, setLockCodeEnabled] = useState(true);
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const [adminName, setAdminName] = useState('Admin');
  const [adminPermissions, setAdminPermissions] = useState<string[]>(ALL_PERMISSIONS);
  const [testMode, setTestMode] = useState(false);
  const [sandboxActive, setSandboxActive] = useState(false);
  const [testUserCode, setTestUserCode] = useState('');
  const [testGuestSession, setTestGuestSession] = useState(false);
  const [showThankYou, setShowThankYou] = useState(false);
  const [thankYouShowsCode, setThankYouShowsCode] = useState(true);
  const [adminCodes, setAdminCodes] = useState<AdminCode[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementItems, setSettlementItems] = useState<SettlementItem[]>([]);
  const [tikkieBlock, setTikkieBlock] = useState<{ amount: number } | null>(null);
  const [showMissingItemDialog, setShowMissingItemDialog] = useState(false);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [registerForm, setRegisterForm] = useState({ name: '', code: '' });
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'stock'>('name');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [missingItemForm, setMissingItemForm] = useState({
    product_name: '',
    quantity: 1,
    reason: '',
    reported_by: 'Admin'
  });
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [selectedUserForReceipt, setSelectedUserForReceipt] = useState<{ code: string; name: string; orders: Order[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Onderhoudsmodus opnieuw ophalen zodra het startscherm te zien is,
  // zodat een wijziging door iemand anders (op een ander apparaat) ook
  // hier zichtbaar wordt.
  useEffect(() => {
    if (currentScreen === 'start') {
      loadSettings();
      // Bij terugkeer naar het startscherm is niemand meer als beheerder ingelogd.
      setIsMainAdmin(false);
      setAdminName('Admin');
      setAdminPermissions(ALL_PERMISSIONS);
      // Op het startscherm altijd weer met de echte database werken.
      activeClient = realSupabase;
      setSandboxActive(false);
      setTestGuestSession(false);
    }
  }, [currentScreen]);

  // Filter and search products
  useEffect(() => {
    let filtered = products.filter(product =>
      product.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (filterLowStock) {
      filtered = filtered.filter(product => product.stock <= 5);
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'price':
          return a.price - b.price;
        case 'stock':
          return a.stock - b.stock;
        default:
          return a.name.localeCompare(b.name);
      }
    });

    setFilteredProducts(filtered);
  }, [products, searchQuery, sortBy, filterLowStock]);

  // Filter users
  useEffect(() => {
    const filtered = users.filter(user =>
      user.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      user.code.toLowerCase().includes(userSearchQuery.toLowerCase())
    );
    setFilteredUsers(filtered);
  }, [users, userSearchQuery]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Mag de ingelogde beheerder dit onderdeel van Beheer gebruiken?
  const can = (permission: string) => isMainAdmin || adminPermissions.includes(permission);

  const promptUserCode = async () => {
    const code = prompt("Voer je gebruikerscode in:");
    if (code) {
      setLoading(true);
      try {
        // Tijdens de testfase kan er niet besteld worden (vers gecontroleerd).
        if (await fetchRealTestMode()) {
          setTestMode(true);
          if (code.trim().toUpperCase() === TEST_USER_CODE) {
            await startGuestTest();
            return;
          }
          toast({
            title: "Testfase actief",
            description: "Bestellen kan op dit moment niet. Probeer het later nog eens.",
            variant: "destructive"
          });
          return;
        }
        const { data } = await supabase
          .from('users_2025_10_08_21_03')
          .select('*')
          .eq('code', code)
          .single();
        
        if (data && data.status === 'pending') {
          toast({
            title: "Nog niet goedgekeurd",
            description: "Je registratie wacht nog op goedkeuring door de beheerder",
            variant: "destructive"
          });
        } else if (data) {
          // Openstaande tikkie niet op tijd betaald? Dan geen toegang tot bestellen.
          const tikkie = await getTikkieStatus(data.code);
          if (tikkie.overdueAmount > 0) {
            setTikkieBlock({ amount: tikkie.overdueAmount });
            return;
          }
          if (tikkie.pendingAmount > 0 && tikkie.nextDue) {
            toast({
              title: "Tikkie openstaand",
              description: `Betaal €${tikkie.pendingAmount.toFixed(2)} vóór ${tikkie.nextDue.toLocaleString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`,
              duration: 8000
            });
          }
          setCurrentUser(data);
          loadOrderScreen();
        } else {
          toast({
            title: "Fout",
            description: "Ongeldige gebruikerscode",
            variant: "destructive"
          });
        }
      } catch (error) {
        toast({
          title: "Fout",
          description: "Er ging iets mis bij het inloggen",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    }
  };

  // Leest (altijd uit de echte database) of de testfase aan staat.
  const fetchRealTestMode = async (): Promise<boolean> => {
    try {
      const { data } = await realSupabase
        .from('app_settings_2025_10_08_21_03')
        .select('test_mode')
        .eq('id', 1)
        .single();
      return data?.test_mode === true;
    } catch (error) {
      return false;
    }
  };

  // Kopieert (alleen lezend) de echte data naar het geheugen en laat de app
  // daarna met die kopie werken. Wat je ook doet: de echte data blijft staan.
  const enterSandbox = async () => {
    setLoading(true);
    try {
      const store = await loadSandboxStore(realSupabase);
      activeClient = createSandboxClient(store);
      setSandboxActive(true);
      // Echte data van het scherm halen zodat die niet met testdata mengt.
      const { data: sandboxUsers } = await supabase.from('users_2025_10_08_21_03').select('*');
      setUsers(sandboxUsers || []);
      setProducts([]);
      setOrders([]);
      setMissingItems([]);
      setMonthlyRevenue([]);
      setSettlements([]);
      setSettlementItems([]);
      setAdminCodes([]);
      setAdminSection('');
    } finally {
      setLoading(false);
    }
  };

  const exitSandbox = () => {
    activeClient = realSupabase;
    setSandboxActive(false);
    setUsers([]);
    setProducts([]);
    setOrders([]);
    setMissingItems([]);
    setMonthlyRevenue([]);
    setSettlements([]);
    setSettlementItems([]);
    setAdminCodes([]);
    setAdminSection('');
  };

  // Zet de testfase aan of uit (alleen met recht op "instellingen").
  // Dit is de enige echte schrijfactie van de testfase: de vlag zelf, zodat
  // het startscherm op alle apparaten de melding kan tonen.
  const toggleTestMode = async () => {
    const newValue = !testMode;
    if (newValue) {
      if (!confirm("Testfase aanzetten?\n\nGasten kunnen dan tijdelijk niet bestellen en zien een melding op het startscherm. Alles wat je in Beheer doet gebeurt op een kopie van de data en wordt NIET opgeslagen.")) return;
    } else if (sandboxActive) {
      if (!confirm("Testfase uitzetten?\n\nAlle testdata verdwijnt en Beheer werkt weer met de echte data.")) return;
    }

    setLoading(true);
    try {
      const { error } = await realSupabase
        .from('app_settings_2025_10_08_21_03')
        .update({ test_mode: newValue, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;
      setTestMode(newValue);
      if (newValue) {
        await enterSandbox();
        toast({ title: "Testfase aan", description: "Je werkt nu met een kopie. Niets wordt opgeslagen.", duration: 6000 });
      } else {
        exitSandbox();
        await loadSettings();
        toast({ title: "Testfase uit", description: "Beheer werkt weer met de echte data. Bestellen kan weer.", duration: 6000 });
      }
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon de testfase niet wijzigen (is het SQL-script al gedraaid?)",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Begin opnieuw met een verse kopie van de echte data.
  const resetSandbox = async () => {
    await enterSandbox();
    toast({ title: "Testdata gereset", description: "Je werkt weer met een verse kopie van de echte data." });
  };

  // Inloggen als testgebruiker op het gewone bestelscherm: de app werkt dan
  // op een kopie van de data, dus echte voorraad en bestellingen blijven
  // ongemoeid.
  const startGuestTest = async () => {
    await enterSandbox();
    await supabase
      .from('users_2025_10_08_21_03')
      .insert({ name: 'Testgebruiker', code: TEST_USER_CODE, status: 'approved' });
    const { data: testUser } = await supabase
      .from('users_2025_10_08_21_03')
      .select('*')
      .eq('code', TEST_USER_CODE)
      .single();
    if (!testUser) {
      toast({ title: "Fout", description: "Kon de testgebruiker niet aanmaken", variant: "destructive" });
      return;
    }
    setTestGuestSession(true);
    setCurrentUser(testUser);
    await loadOrderScreen();
    toast({ title: "Testgebruiker", description: "Je bestelt op een kopie. Niets wordt echt opgeslagen." });
  };

  // Een testbestelling plaatsen als een bestaande gebruiker (op de kopie).
  const startTestOrder = async () => {
    const approved = users.filter(u => u.status !== 'pending');
    const user = approved.find(u => u.code === testUserCode) || approved[0];
    if (!user) {
      toast({ title: "Fout", description: "Er is geen gebruiker om mee te testen", variant: "destructive" });
      return;
    }
    const tikkie = await getTikkieStatus(user.code);
    if (tikkie.overdueAmount > 0) {
      setTikkieBlock({ amount: tikkie.overdueAmount });
      return;
    }
    setCurrentUser(user);
    await loadOrderScreen();
  };

  // Kijkt of iemand openstaande (onbetaalde) tikkies heeft, en of de
  // betaaltermijn daarvan al verlopen is. Bij een fout (bv. tabellen nog
  // niet aangemaakt) wordt niemand geblokkeerd.
  const getTikkieStatus = async (userCode: string) => {
    const result = { overdueAmount: 0, pendingAmount: 0, nextDue: null as Date | null };
    try {
      const { data: items, error } = await supabase
        .from('settlement_items_2025_10_08_21_03')
        .select('*')
        .eq('user_code', userCode)
        .eq('paid', false);
      if (error || !items || items.length === 0) return result;

      const ids = [...new Set(items.map(i => i.settlement_id))];
      const { data: sets, error: setsError } = await supabase
        .from('settlements_2025_10_08_21_03')
        .select('*')
        .in('id', ids);
      if (setsError || !sets) return result;

      const now = new Date();
      for (const item of items) {
        const s = sets.find(x => x.id === item.settlement_id);
        if (!s) continue;
        const due = new Date(s.due_at);
        if (due <= now) {
          result.overdueAmount += Number(item.amount);
        } else {
          result.pendingAmount += Number(item.amount);
          if (!result.nextDue || due < result.nextDue) result.nextDue = due;
        }
      }
    } catch (error) {
      // stil negeren: liever iemand laten bestellen dan onterecht blokkeren
    }
    return result;
  };

  // Stil (zonder laadscherm) ophalen, zodat de rode teller bij "Tikkies"
  // meteen klopt zodra je in Beheer komt.
  const refreshSettlements = async () => {
    try {
      const [st, it] = await Promise.all([
        supabase.from('settlements_2025_10_08_21_03').select('*').order('created_at', { ascending: false }),
        supabase.from('settlement_items_2025_10_08_21_03').select('*').order('user_name', { ascending: true }),
      ]);
      if (!st.error && !it.error) {
        setSettlements(st.data || []);
        setSettlementItems(it.data || []);
      }
    } catch (error) {
      // tabellen nog niet aanwezig: geen teller
    }
  };

  // Opent het beheerscherm. Staat de testfase aan, dan werkt elke beheerder
  // automatisch met de testkopie in plaats van de echte data.
  const openAdmin = async (name: string, main: boolean, permissions: string[]) => {
    const realTest = await fetchRealTestMode();
    setTestMode(realTest);
    if (realTest) {
      await enterSandbox();
    } else {
      activeClient = realSupabase;
      setSandboxActive(false);
    }
    setIsMainAdmin(main);
    setAdminName(name);
    setAdminPermissions(permissions);
    setMissingItemForm(prev => ({ ...prev, reported_by: name }));
    setCurrentScreen('admin');
    setAdminSection('');
    refreshSettlements();
  };

  const promptAdminCode = async () => {
    const code = prompt("Voer de beheercode in:");
    if (code === null) return; // geannuleerd

    setLoading(true);
    try {
      if (code === MAIN_ADMIN_CODE) {
        await openAdmin('Admin', true, ALL_PERMISSIONS);
        return;
      }

      const { data } = code
        ? await supabase.from('admin_codes_2025_10_08_21_03').select('*').eq('code', code).maybeSingle()
        : { data: null };
      if (data) {
        await openAdmin(data.name, false, Array.isArray(data.permissions) ? data.permissions : ALL_PERMISSIONS);
        toast({ title: `Welkom ${data.name}`, description: "Ingelogd als beheerder" });
      } else {
        toast({
          title: "Fout",
          description: "Ongeldige beheercode",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Fout",
        description: "Ongeldige beheercode",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadOrderScreen = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('products_2025_10_08_21_03').select('*');
      setProducts(data || []);
      setCurrentScreen('order');
      setCart([]);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon producten niet laden",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) }
            : item
        );
      } else {
        return [...prev, { id: product.id, name: product.name, price: product.price, quantity: 1 }];
      }
    });

    // Visual feedback
    toast({
      title: "Toegevoegd",
      description: `${product.name} toegevoegd aan winkelwagentje`,
    });
  };

  const updateCartQuantity = (productId: number, change: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    setCart(prev => {
      return prev.map(item => {
        if (item.id === productId) {
          const newQuantity = Math.max(0, Math.min(item.quantity + change, product.stock));
          return newQuantity === 0 ? null : { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(Boolean) as CartItem[];
    });
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const confirmOrder = () => {
    if (cart.length === 0) {
      toast({
        title: "Fout",
        description: "Je winkelwagentje is leeg",
        variant: "destructive"
      });
      return;
    }
    setShowConfirmOrder(true);
  };

  const placeOrder = async () => {
    if (!currentUser) return;

    // Eerst alle regels van het winkelwagentje controleren, vóórdat er
    // iets wordt weggeschreven. Zo voorkomen we dat een deel van de
    // bestelling al is verwerkt wanneer een later item niet op voorraad
    // blijkt te zijn.
    for (const item of cart) {
      const product = products.find(p => p.id === item.id);
      if (!product || product.stock < item.quantity) {
        toast({
          title: "Fout",
          description: `Onvoldoende voorraad voor ${item.name}`,
          variant: "destructive"
        });
        return;
      }
    }

    setLoading(true);
    try {
      // Testfase aangezet terwijl iemand al aan het bestellen was? Dan niet doorgaan.
      if (!sandboxActive && (await fetchRealTestMode())) {
        setShowConfirmOrder(false);
        setCart([]);
        setTestMode(true);
        setCurrentScreen('start');
        setCurrentUser(null);
        toast({
          title: "Testfase actief",
          description: "Bestellen kan op dit moment niet. Je bestelling is niet geplaatst.",
          variant: "destructive"
        });
        return;
      }

      // Is de betaaltermijn van een tikkie intussen verlopen? Dan niet meer bestellen.
      const tikkie = await getTikkieStatus(currentUser.code);
      if (tikkie.overdueAmount > 0) {
        setShowConfirmOrder(false);
        setCart([]);
        setTikkieBlock({ amount: tikkie.overdueAmount });
        setCurrentScreen(sandboxActive && !testGuestSession ? 'admin' : 'start');
        setCurrentUser(null);
        return;
      }

      // Alle voorraad- en bestel-writes gelijktijdig versturen in plaats
      // van na elkaar te wachten op elk item.
      const results = await Promise.all(
        cart.flatMap(item => {
          const product = products.find(p => p.id === item.id)!;
          return [
            supabase
              .from('products_2025_10_08_21_03')
              .update({ stock: product.stock - item.quantity })
              .eq('id', item.id),
            supabase
              .from('orders_2025_10_08_21_03')
              .insert({
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                user_code: currentUser.code
              }),
          ];
        })
      );

      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;

      toast({
        title: "Succes! 🎉",
        description: "Bestelling succesvol geplaatst!",
      });

      setCart([]);
      setShowConfirmOrder(false);

      // Slotcode-popup alleen tonen als de beheerder die aan heeft staan.
      // Vers ophalen, want de instelling kan op een ander apparaat zijn gewijzigd.
      let showCode = true;
      try {
        const { data } = await supabase
          .from('app_settings_2025_10_08_21_03')
          .select('lock_code_enabled')
          .eq('id', 1)
          .single();
        if (data && data.lock_code_enabled === false) showCode = false;
      } catch (e) {
        // instelling onbekend: veilig terugvallen op tonen
      }

      // Eerst een korte bedankt-animatie; daarna de slotcode (of terug naar start).
      setThankYouShowsCode(showCode);
      setShowThankYou(true);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Er ging iets mis bij het plaatsen van de bestelling",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Sluit de bedankt-animatie af (vanzelf na een paar seconden, of door erop te tikken).
  const finishThankYou = () => {
    setShowThankYou(false);
    if (thankYouShowsCode) {
      setShowLockCodeDialog(true);
    } else {
      setCurrentScreen(sandboxActive && !testGuestSession ? 'admin' : 'start');
      setCurrentUser(null);
    }
  };

  useEffect(() => {
    if (!showThankYou) return;
    const t = setTimeout(finishThankYou, 3200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showThankYou]);

  const closeLockCodeDialog = () => {
    setShowLockCodeDialog(false);
    setCurrentScreen(sandboxActive && !testGuestSession ? 'admin' : 'start');
    setCurrentUser(null);
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('users_2025_10_08_21_03').select('*');
      setUsers(data || []);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon gebruikers niet laden",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('products_2025_10_08_21_03').select('*');
      setProducts(data || []);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon producten niet laden",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadOrders = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('orders_2025_10_08_21_03').select('*');
      setOrders(data || []);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon bestellingen niet laden",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMissingItems = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('missing_items_2025_10_08_21_03').select('*');
      setMissingItems(data || []);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon verdwenen goederen niet laden",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMonthlyRevenue = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('monthly_revenue_2025_10_09_18_50').select('*').order('year', { ascending: false }).order('month', { ascending: false });
      setMonthlyRevenue(data || []);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon maandelijkse omzet niet laden",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Laadt bestellingen, verdwenen goederen en maandomzet gelijktijdig,
  // met één gedeelde loading-status. Zo voorkomen we dat drie losse
  // aanroepen elkaars "loading" waarde overschrijven (race condition).
  const loadRevenueData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        (async () => {
          const { data } = await supabase.from('orders_2025_10_08_21_03').select('*');
          setOrders(data || []);
        })(),
        (async () => {
          const { data } = await supabase.from('missing_items_2025_10_08_21_03').select('*');
          setMissingItems(data || []);
        })(),
        (async () => {
          const { data } = await supabase
            .from('monthly_revenue_2025_10_09_18_50')
            .select('*')
            .order('year', { ascending: false })
            .order('month', { ascending: false });
          setMonthlyRevenue(data || []);
        })(),
      ]);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon omzetgegevens niet laden",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // ---------- App-instellingen (onderhoudsmodus, slotcode-popup) ----------
  // Staan in een eigen instellingen-tabel zodat elk apparaat (niet alleen
  // dit scherm) dezelfde status ziet, ook nadat iemand anders ze heeft
  // gewijzigd.
  const loadSettings = async () => {
    try {
      // Bewust altijd de echte database: dit bepaalt wat gasten op het
      // startscherm zien (onderhoud, testfase).
      const { data } = await realSupabase
        .from('app_settings_2025_10_08_21_03')
        .select('*')
        .eq('id', 1)
        .single();
      if (data) {
        setMaintenanceMode(!!data.maintenance_mode);
        if (data.maintenance_message) setMaintenanceMessage(data.maintenance_message);
        setLockCodeEnabled(data.lock_code_enabled !== false);
        setTestMode(data.test_mode === true);
      }
    } catch (error) {
      // Instellingen-tabel bestaat nog niet of is niet bereikbaar:
      // gewoon stil negeren, standaardwaarden blijven dan gelden.
    }
  };

  // Schrijft een instelling weg en gooit een fout als dat mislukt, zodat de
  // schakelaar niet "aan" blijft staan terwijl de database niets opsloeg.
  const updateSetting = async (patch: Record<string, unknown>) => {
    const { error } = await supabase
      .from('app_settings_2025_10_08_21_03')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw error;
  };

  const toggleMaintenanceMode = async () => {
    const newValue = !maintenanceMode;
    setLoading(true);
    try {
      await updateSetting({ maintenance_mode: newValue });
      setMaintenanceMode(newValue);
      toast({
        title: "Succes",
        description: newValue ? "Onderhoudsmodus staat nu aan" : "Onderhoudsmodus staat nu uit"
      });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon onderhoudsmodus niet wijzigen",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleLockCodeEnabled = async () => {
    const newValue = !lockCodeEnabled;
    setLoading(true);
    try {
      await updateSetting({ lock_code_enabled: newValue });
      setLockCodeEnabled(newValue);
      toast({
        title: "Succes",
        description: newValue
          ? "De slotcode wordt weer getoond na een bestelling"
          : "De slotcode wordt na een bestelling niet meer getoond"
      });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon instelling niet wijzigen (is het SQL-script al gedraaid?)",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // ---------- Extra beheercodes (alleen hoofdbeheerder) ----------
  const loadAdminCodes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('admin_codes_2025_10_08_21_03')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setAdminCodes(data || []);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon beheercodes niet laden (is het SQL-script al gedraaid?)",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const addAdminCode = async (name: string, code: string, permissions: string[]) => {
    const cleanName = name.trim();
    const cleanCode = code.trim();
    if (!cleanName || !cleanCode) {
      toast({ title: "Fout", description: "Vul een naam en een code in", variant: "destructive" });
      return;
    }
    if (cleanCode === MAIN_ADMIN_CODE) {
      toast({ title: "Fout", description: "Deze code is al in gebruik", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('admin_codes_2025_10_08_21_03')
        .insert({ name: cleanName, code: cleanCode, permissions });
      if (error) {
        if (error.code === '23505') {
          toast({ title: "Fout", description: "Deze code is al in gebruik, kies een andere", variant: "destructive" });
          return;
        }
        throw error;
      }
      await loadAdminCodes();
      toast({ title: "Succes", description: `Beheercode voor ${cleanName} aangemaakt` });
    } catch (error) {
      toast({ title: "Fout", description: "Kon beheercode niet aanmaken", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const updateAdminPermissions = async (id: number, permissions: string[]) => {
    try {
      const { error } = await supabase
        .from('admin_codes_2025_10_08_21_03')
        .update({ permissions })
        .eq('id', id);
      if (error) throw error;
      setAdminCodes(prev => prev.map(a => (a.id === id ? { ...a, permissions } : a)));
    } catch (error) {
      toast({ title: "Fout", description: "Kon rechten niet opslaan (is het SQL-script al gedraaid?)", variant: "destructive" });
    }
  };

  const deleteAdminCode = async (id: number) => {
    if (!confirm("Weet je zeker dat je deze beheercode wilt verwijderen? Deze beheerder kan daarna niet meer inloggen.")) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('admin_codes_2025_10_08_21_03').delete().eq('id', id);
      if (error) throw error;
      await loadAdminCodes();
      toast({ title: "Succes", description: "Beheercode verwijderd" });
    } catch (error) {
      toast({ title: "Fout", description: "Kon beheercode niet verwijderen", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ---------- Tikkie-afrekeningen ----------
  // Laadt in één keer alles wat het Tikkie-scherm nodig heeft.
  const loadSettlementData = async () => {
    setLoading(true);
    try {
      const [o, u, s, i] = await Promise.all([
        supabase.from('orders_2025_10_08_21_03').select('*'),
        supabase.from('users_2025_10_08_21_03').select('*'),
        supabase.from('settlements_2025_10_08_21_03').select('*').order('created_at', { ascending: false }),
        supabase.from('settlement_items_2025_10_08_21_03').select('*').order('user_name', { ascending: true }),
      ]);
      setOrders(o.data || []);
      setUsers(u.data || []);
      if (s.error || i.error) throw (s.error || i.error);
      setSettlements(s.data || []);
      setSettlementItems(i.data || []);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon tikkie-gegevens niet laden (is het SQL-script al gedraaid?)",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Zet de huidige stand vast (in één databasetransactie): per gebruiker
  // wordt het bedrag vastgelegd, de huidige bestellingen worden aan deze
  // afrekening gekoppeld en de lopende bestelgeschiedenis begint opnieuw.
  const createSettlement = async (dueAt: Date) => {
    if (isNaN(dueAt.getTime())) {
      toast({ title: "Fout", description: "Kies een geldige betaaltermijn", variant: "destructive" });
      return;
    }
    if (!confirm("Weet je zeker dat je de huidige stand wilt vastzetten?\n\nDe huidige bestelgeschiedenis begint daarna opnieuw.")) return;

    setLoading(true);
    try {
      const { error } = await supabase.rpc('create_settlement', { p_due_at: dueAt.toISOString() });
      if (error) throw error;
      await loadSettlementData();
      toast({ title: "Vastgezet", description: "De afrekening staat klaar. De bestelgeschiedenis begint opnieuw.", duration: 6000 });
    } catch (error: any) {
      toast({
        title: "Fout",
        description: error?.message?.includes('Geen openstaande')
          ? "Er zijn geen openstaande bestellingen om vast te zetten"
          : "Kon de stand niet vastzetten (is het SQL-script al gedraaid?)",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const setItemPaid = async (itemId: number, paid: boolean) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('settlement_items_2025_10_08_21_03')
        .update({ paid, paid_at: paid ? new Date().toISOString() : null })
        .eq('id', itemId);
      if (error) throw error;
      await loadSettlementData();
    } catch (error) {
      toast({ title: "Fout", description: "Kon betaalstatus niet wijzigen", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const updateSettlementDue = async (settlementId: number, dueAt: Date) => {
    if (isNaN(dueAt.getTime())) {
      toast({ title: "Fout", description: "Kies een geldige betaaltermijn", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('settlements_2025_10_08_21_03')
        .update({ due_at: dueAt.toISOString() })
        .eq('id', settlementId);
      if (error) throw error;
      await loadSettlementData();
      toast({ title: "Succes", description: "Betaaltermijn aangepast" });
    } catch (error) {
      toast({ title: "Fout", description: "Kon betaaltermijn niet aanpassen", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ---------- Zelf registreren ----------
  // Iedereen kan zelf een naam + code aanmaken, maar kan pas bestellen
  // nadat een beheerder de registratie heeft goedgekeurd.
  const registerUser = async () => {
    const name = registerForm.name.trim();
    const code = registerForm.code.trim();

    if (!name || !code) {
      toast({
        title: "Fout",
        description: "Vul je naam en een code in",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('users_2025_10_08_21_03')
        .insert({ name, code, status: 'pending' });

      if (error) {
        if (error.code === '23505') {
          toast({
            title: "Fout",
            description: "Deze code is al in gebruik, kies een andere",
            variant: "destructive"
          });
        } else {
          throw error;
        }
        return;
      }

      setRegisterForm({ name: '', code: '' });
      setShowRegisterDialog(false);
      toast({
        title: "Registratie verstuurd",
        description: "Je kunt bestellen zodra een beheerder je hebt goedgekeurd",
        duration: 6000
      });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon registratie niet versturen",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const approveUser = async (id: number) => {
    setLoading(true);
    try {
      await supabase.from('users_2025_10_08_21_03').update({ status: 'approved' }).eq('id', id);
      await loadUsers();
      toast({ title: "Succes", description: "Gebruiker goedgekeurd" });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon gebruiker niet goedkeuren",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const rejectUser = async (id: number) => {
    if (!confirm("Weet je zeker dat je deze registratie wilt afwijzen? De aanvraag wordt verwijderd.")) return;

    setLoading(true);
    try {
      await supabase.from('users_2025_10_08_21_03').delete().eq('id', id);
      await loadUsers();
      toast({ title: "Succes", description: "Registratie afgewezen" });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon registratie niet afwijzen",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const addUser = async (name: string, code: string) => {
    if (!name || !code) {
      toast({
        title: "Fout",
        description: "Vul alle velden in",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      await supabase.from('users_2025_10_08_21_03').insert({ name, code, status: 'approved' });
      await loadUsers();
      toast({ title: "Succes", description: "Gebruiker toegevoegd" });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon gebruiker niet toevoegen",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (id: number) => {
    if (!confirm("Weet je zeker dat je deze gebruiker wilt verwijderen?")) return;

    setLoading(true);
    try {
      await supabase.from('users_2025_10_08_21_03').delete().eq('id', id);
      await loadUsers();
      toast({ title: "Succes", description: "Gebruiker verwijderd" });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon gebruiker niet verwijderen",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const addProduct = async (name: string, price: number, stock: number, description: string = '') => {
    if (!name || price <= 0) {
      toast({
        title: "Fout",
        description: "Vul alle velden correct in",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      await supabase.from('products_2025_10_08_21_03').insert({ name, price, stock, description });
      const { data } = await supabase.from('products_2025_10_08_21_03').select('*');
      setProducts(data || []);
      toast({ title: "Succes", description: "Product toegevoegd" });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon product niet toevoegen",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteProduct = async (id: number) => {
    if (!confirm("Weet je zeker dat je dit product wilt verwijderen?")) return;

    setLoading(true);
    try {
      await supabase.from('products_2025_10_08_21_03').delete().eq('id', id);
      const { data } = await supabase.from('products_2025_10_08_21_03').select('*');
      setProducts(data || []);
      toast({ title: "Succes", description: "Product verwijderd" });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon product niet verwijderen",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const updateProduct = async (id: number, updates: Partial<Product>) => {
    setLoading(true);
    try {
      await supabase.from('products_2025_10_08_21_03').update(updates).eq('id', id);
      const { data } = await supabase.from('products_2025_10_08_21_03').select('*');
      setProducts(data || []);
      toast({ title: "Succes", description: "Product bijgewerkt" });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon product niet bijwerken",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const updateStock = async (id: number, stock: number) => {
    if (stock < 0) {
      toast({
        title: "Fout",
        description: "Voorraad kan niet negatief zijn",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const product = products.find(p => p.id === id);
      const diff = product ? product.stock - stock : 0;

      await supabase.from('products_2025_10_08_21_03').update({ stock }).eq('id', id);

      // If the stock was manually lowered, log the difference automatically
      // so it shows up under "Verdwenen goederen" instead of silently disappearing.
      if (product && diff > 0) {
        await supabase.from('missing_items_2025_10_08_21_03').insert({
          product_name: product.name,
          quantity: diff,
          reason: `Voorraad handmatig verlaagd (verschil van ${diff} automatisch geregistreerd)`,
          reported_by: 'Voorraadbeheer (automatisch)'
        });
        await loadMissingItems();
      }

      const { data } = await supabase.from('products_2025_10_08_21_03').select('*');
      setProducts(data || []);

      if (product && diff > 0) {
        toast({
          title: "Succes",
          description: `Voorraad bijgewerkt — verschil van ${diff} geregistreerd bij Verdwenen goederen`,
          duration: 5000
        });
      } else {
        toast({ title: "Succes", description: "Voorraad bijgewerkt" });
      }
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon voorraad niet bijwerken",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const reportMissingItem = async () => {
    if (!missingItemForm.product_name || !missingItemForm.reason) {
      toast({
        title: "Fout",
        description: "Vul alle velden in",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      await supabase.from('missing_items_2025_10_08_21_03').insert(missingItemForm);
      
      // Update product stock if product exists
      const product = products.find(p => p.name === missingItemForm.product_name);
      if (product) {
        await supabase
          .from('products_2025_10_08_21_03')
          .update({ stock: Math.max(0, product.stock - missingItemForm.quantity) })
          .eq('id', product.id);
        
        const { data } = await supabase.from('products_2025_10_08_21_03').select('*');
        setProducts(data || []);
      }

      setMissingItemForm({ product_name: '', quantity: 1, reason: '', reported_by: adminName });
      setShowMissingItemDialog(false);
      await loadMissingItems();
      toast({ title: "Succes", description: "Verdwenen goederen geregistreerd" });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon verdwenen goederen niet registreren",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const clearAllOrders = async () => {
    if (!confirm("Weet je zeker dat je alle lopende bestellingen wilt verwijderen?\n\nLet op: De maandelijkse omzet blijft behouden en vastgezette tikkie-afrekeningen blijven staan.")) return;

    setLoading(true);
    try {
      const { error: clearError } = await supabase
        .from('orders_2025_10_08_21_03')
        .delete()
        .is('settlement_id', null);
      if (clearError) throw clearError;
      await loadOrders();
      toast({
        title: "Succes", 
        description: "Alle bestellingen verwijderd. Maandelijkse omzet blijft behouden.",
        duration: 5000
      });
    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon bestellingen niet verwijderen",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const getMonthlyRevenue = () => {
    const monthlyData: { [key: string]: number } = {};
    
    // Use only persistent monthly revenue data from database
    // This ensures data persists even when order history is cleared
    monthlyRevenue.forEach(record => {
      const monthName = new Date(record.year, record.month - 1).toLocaleDateString('nl-NL', { 
        year: 'numeric', 
        month: 'long' 
      });
      monthlyData[monthName] = record.revenue;
    });
    
    return monthlyData;
  };

  const getRevenueByProduct = () => {
    const productData: { [key: string]: number } = {};
    orders.forEach(order => {
      productData[order.name] = (productData[order.name] || 0) + (order.price * order.quantity);
    });
    return productData;
  };

  const getMissingItemsLoss = () => {
    const lossData: { [key: string]: number } = {};
    // Persistent per-month breakdown, computed from each item's own date —
    // so it naturally keeps every past month, while "currentMonthLoss"
    // always starts back at €0 as soon as a new month begins.
    const monthlyLoss: { [key: string]: { year: number; month: number; loss: number } } = {};
    let totalLoss = 0;
    let currentMonthLoss = 0;

    const now = new Date();
    const currentKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

    missingItems.forEach(item => {
      const product = products.find(p => p.name === item.product_name);
      if (product) {
        const loss = product.price * item.quantity;
        lossData[item.product_name] = (lossData[item.product_name] || 0) + loss;
        totalLoss += loss;

        const d = new Date(item.created_at);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        if (!monthlyLoss[key]) {
          monthlyLoss[key] = { year: d.getFullYear(), month: d.getMonth() + 1, loss: 0 };
        }
        monthlyLoss[key].loss += loss;

        if (key === currentKey) currentMonthLoss += loss;
      }
    });

    return { lossData, totalLoss, currentMonthLoss, monthlyLoss };
  };

  const generateReceipt = (userCode: string, userName: string, userOrders: Order[]) => {
    setSelectedUserForReceipt({
      code: userCode,
      name: userName,
      orders: userOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    });
    setShowReceiptDialog(true);
  };

  // De bon wordt gedownload als een op zichzelf staand HTML-bestand (geen
  // popup, geen printdialoog) — open het bestand in elke browser en het
  // ziet er meteen uit als een net bonnetje, met dezelfde inhoud als het
  // voorbeeld hierboven.
  const downloadReceipt = () => {
    if (!selectedUserForReceipt) return;

    const total = selectedUserForReceipt.orders.reduce((sum, order) => sum + (order.price * order.quantity), 0);
    const now = new Date();
    const dateLabel = now.toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const receiptHTML = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8" />
<title>Bon - ${selectedUserForReceipt.name}</title>
<style>
  body { font-family: 'Courier New', monospace; max-width: 320px; margin: 40px auto; padding: 20px; line-height: 1.5; color: #1c1712; background: #faf9f4; }
  .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
  .title { font-size: 20px; font-weight: bold; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #666; }
  .customer { margin-bottom: 15px; }
  .item { display: flex; justify-content: space-between; margin-bottom: 6px; gap: 12px; }
  .item-name { flex: 1; }
  .separator { border-top: 1px dashed #000; margin: 12px 0; }
  .total { font-weight: bold; font-size: 17px; text-align: right; }
  .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #666; }
</style>
</head>
<body>
  <div class="header">
    <div class="title">🍺 BAR APP</div>
    <div class="subtitle">Kassabon</div>
  </div>
  <div class="customer">
    <strong>Klant:</strong> ${selectedUserForReceipt.name}<br>
    <strong>Code:</strong> ${selectedUserForReceipt.code}<br>
    <strong>Datum bon:</strong> ${dateLabel}
  </div>
  <div class="separator"></div>
  ${selectedUserForReceipt.orders.map(order => `
  <div class="item">
    <span class="item-name">${order.name} x${order.quantity}</span>
    <span>€${(order.price * order.quantity).toFixed(2)}</span>
  </div>`).join('')}
  <div class="separator"></div>
  <div class="total">TOTAAL: €${total.toFixed(2)}</div>
  <div class="footer">Bedankt voor uw bezoek!<br>Tot ziens! 🍻</div>
</body>
</html>`;

    const safeName = selectedUserForReceipt.name.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'klant';
    const fileDate = now.toISOString().slice(0, 10);
    const fileName = `bon-${safeName}-${fileDate}.html`;

    const blob = new Blob([receiptHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({ title: "Bon gedownload", description: fileName });
  };

  const tikkieDialog = (
        <Dialog open={tikkieBlock !== null} onOpenChange={(open) => { if (!open) setTikkieBlock(null); }}>
          <DialogContent className="bar-card">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Wallet className="h-5 w-5" />
                Eerst je tikkie betalen
              </DialogTitle>
              <DialogDescription>
                Je hebt een openstaande tikkie van €{tikkieBlock?.amount.toFixed(2)} die niet op tijd is betaald.
                Bestellen kan pas weer nadat je die hebt betaald. Zet je drinken voor nu terug.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setTikkieBlock(null)} className="w-full glow-effect">
                Begrepen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
  );

  if (currentScreen === 'start') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted to-background flex items-center justify-center p-4 animate-fade-in">
        <div className="w-full max-w-md space-y-4">
          {testMode && (
            <div className="bg-destructive/10 border border-destructive/40 text-foreground rounded-xl p-4 flex items-start gap-3 animate-slide-up">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Testfase actief</p>
                <p className="text-sm text-muted-foreground">De app wordt op dit moment getest. Bestellen kan nu niet; probeer het later nog eens.</p>
              </div>
            </div>
          )}
          {maintenanceMode && (
            <div className="bg-primary/15 border border-primary/40 text-foreground rounded-xl p-4 flex items-start gap-3 animate-slide-up">
              <AlertTriangle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Onderhoud</p>
                <p className="text-sm text-muted-foreground">{maintenanceMessage}</p>
              </div>
            </div>
          )}
          <Card className="w-full bar-card animate-bounce-in">
            <CardHeader className="text-center">
              <CardTitle className="text-3xl font-bold gradient-text mb-2">🍺 Bar App</CardTitle>
              <p className="text-muted-foreground">Welkom bij onze bar</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={promptUserCode}
                className="w-full bar-button glow-effect"
                size="lg"
                disabled={loading}
              >
                <ShoppingCart className="mr-2 h-5 w-5" />
                {loading ? "Laden..." : "Bestellen"}
              </Button>
              <Button
                onClick={() => setShowRegisterDialog(true)}
                variant="secondary"
                className="w-full bar-button"
                size="lg"
                disabled={loading}
              >
                <User className="mr-2 h-5 w-5" />
                Nieuw account aanvragen
              </Button>
              <Button
                onClick={promptAdminCode}
                variant="outline"
                className="w-full bar-button"
                size="lg"
                disabled={loading}
              >
                <User className="mr-2 h-5 w-5" />
                Beheer
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Registratie Dialog */}
        <Dialog open={showRegisterDialog} onOpenChange={setShowRegisterDialog}>
          <DialogContent className="bar-card">
            <DialogHeader>
              <DialogTitle>Nieuw account aanvragen</DialogTitle>
              <DialogDescription>
                Vul je naam en een zelfgekozen code in. Een beheerder moet je registratie nog goedkeuren voordat je kunt bestellen.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Naam"
                value={registerForm.name}
                onChange={(e) => setRegisterForm(prev => ({ ...prev, name: e.target.value }))}
              />
              <Input
                placeholder="Code (zelf kiezen)"
                value={registerForm.code}
                onChange={(e) => setRegisterForm(prev => ({ ...prev, code: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRegisterDialog(false)} disabled={loading}>
                Annuleren
              </Button>
              <Button onClick={registerUser} disabled={loading || !registerForm.name || !registerForm.code} className="glow-effect">
                {loading ? "Versturen..." : "Aanvragen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {tikkieDialog}
      </div>
    );
  }

  if (currentScreen === 'order') {
    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted to-background p-4 animate-fade-in">
        <div className="max-w-4xl mx-auto space-y-6">
          {sandboxActive && (
            <div className="bg-destructive/10 border border-destructive/40 rounded-xl p-3 text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
              Testbestelling: dit gebeurt op een kopie, niets wordt echt opgeslagen.
            </div>
          )}
          {/* Header with user name */}
          <div className="flex justify-between items-center animate-slide-up">
            <h1 className="text-3xl font-bold gradient-text">🛒 Bestellen</h1>
            <div className="flex items-center gap-2 bg-card/50 backdrop-blur-sm rounded-lg px-3 py-2">
              <User className="h-5 w-5 text-primary" />
              <span className="font-medium">{currentUser?.name}</span>
            </div>
          </div>

          {/* Search and Filter Controls */}
          <Card className="bar-card animate-slide-up">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Zoek producten..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'name' | 'price' | 'stock')}
                    className="px-3 py-2 bg-input border border-border rounded-md text-sm"
                  >
                    <option value="name">Sorteer op naam</option>
                    <option value="price">Sorteer op prijs</option>
                    <option value="stock">Sorteer op voorraad</option>
                  </select>
                  <Button
                    variant={filterLowStock ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilterLowStock(!filterLowStock)}
                  >
                    <Filter className="h-4 w-4 mr-1" />
                    Lage voorraad
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Products */}
          <Card className="bar-card animate-slide-up">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Producten ({filteredProducts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                  <p className="mt-2 text-muted-foreground">Laden...</p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Geen producten gevonden</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredProducts.map(product => (
                    <div key={product.id} className="flex justify-between items-center p-4 border rounded-lg bg-card/50 backdrop-blur-sm hover:bg-card/70 transition-all duration-300">
                      <div className="flex-1">
                        <h3 className="font-medium text-lg">{product.name}</h3>
                        {product.description && (
                          <p className="text-sm text-muted-foreground mt-1">{product.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-primary font-bold">€{product.price.toFixed(2)}</span>
                          <Badge variant={product.stock <= 5 ? "destructive" : "secondary"}>
                            Voorraad: {product.stock}
                          </Badge>
                        </div>
                      </div>
                      <Button 
                        onClick={() => addToCart(product)} 
                        disabled={product.stock === 0}
                        size="sm"
                        className="bar-button ml-4"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shopping Cart */}
          <Card className="bar-card animate-slide-up">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Winkelwagentje ({cart.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Je winkelwagentje is leeg</p>
              ) : (
                <div className="space-y-3">
                  {cart.map(item => (
                    <div key={item.id} className="flex justify-between items-center p-4 border rounded-lg bg-card/50 backdrop-blur-sm">
                      <div className="flex-1">
                        <h4 className="font-medium">{item.name}</h4>
                        <p className="text-sm text-muted-foreground">€{item.price.toFixed(2)} per stuk</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => updateCartQuantity(item.id, -1)}
                          className="h-8 w-8 p-0"
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="mx-2 font-medium min-w-[2rem] text-center">{item.quantity}</span>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => updateCartQuantity(item.id, 1)}
                          className="h-8 w-8 p-0"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive"
                          onClick={() => removeFromCart(item.id)}
                          className="ml-2 h-8 w-8 p-0"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between items-center font-bold text-xl bg-primary/10 p-4 rounded-lg">
                    <span>Totaal:</span>
                    <span className="text-primary">€{cartTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="space-y-3 animate-slide-up">
            <Button 
              onClick={confirmOrder} 
              className="w-full bar-button glow-effect" 
              size="lg" 
              disabled={cart.length === 0 || loading}
            >
              {loading ? "Verwerken..." : "Bevestig bestelling"}
            </Button>
            <Button 
              onClick={() => { setCurrentScreen(sandboxActive && !testGuestSession ? 'admin' : 'start'); setCurrentUser(null); setCart([]); }} 
              variant="outline" 
              className="w-full bar-button"
              disabled={loading}
            >
              {sandboxActive && !testGuestSession ? 'Terug naar beheer' : 'Terug naar start'}
            </Button>
          </div>
        </div>

        {/* Confirmation Dialog */}
        <Dialog open={showConfirmOrder} onOpenChange={setShowConfirmOrder}>
          <DialogContent className="bar-card">
            <DialogHeader>
              <DialogTitle>Bestelling bevestigen</DialogTitle>
              <DialogDescription>
                Weet je zeker dat je deze bestelling wilt plaatsen?
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <h4 className="font-medium mb-3">Overzicht:</h4>
              <div className="space-y-2">
                {cart.map(item => (
                  <div key={item.id} className="flex justify-between text-sm p-2 bg-muted/50 rounded">
                    <span>{item.name} x {item.quantity}</span>
                    <span className="font-medium">€{(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <Separator className="my-3" />
              <div className="flex justify-between font-bold text-lg">
                <span>Totaal:</span>
                <span className="text-primary">€{cartTotal.toFixed(2)}</span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirmOrder(false)} disabled={loading}>
                Annuleren
              </Button>
              <Button onClick={placeOrder} disabled={loading} className="glow-effect">
                {loading ? "Verwerken..." : "Bevestigen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bedankt-animatie na een bestelling */}
        {showThankYou && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm animate-fade-in cursor-pointer"
            onClick={finishThankYou}
            role="status"
            aria-live="polite"
          >
            <div className="text-center space-y-4 px-6">
              <svg className="mx-auto h-28 w-28 animate-bounce-in" viewBox="0 0 52 52" aria-hidden="true">
                <circle cx="26" cy="26" r="24" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" />
                <path className="thank-you-check" d="M15 27 l8 8 l15 -17" fill="none" stroke="hsl(var(--primary))" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h2 className="text-4xl font-bold gradient-text animate-slide-up">Bedankt{currentUser ? `, ${currentUser.name}` : ''}!</h2>
              <p className="text-xl text-muted-foreground animate-slide-up">
                Tot ziens <span className="inline-block origin-bottom-right animate-wave" aria-hidden="true">👋</span>
              </p>
            </div>
          </div>
        )}

        {/* Weekly Lock Code Dialog */}
        <Dialog open={showLockCodeDialog} onOpenChange={(open) => { if (!open) closeLockCodeDialog(); }}>
          <DialogContent className="bar-card">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                Code voor het slot
              </DialogTitle>
              <DialogDescription>
                Deze code geldt de hele week en wisselt elke donderdag.
              </DialogDescription>
            </DialogHeader>
            <div className="py-6 text-center">
              <p className="text-5xl font-bold tracking-[0.3em] gradient-text">
                {getWeeklyLockCode()}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={closeLockCodeDialog} className="w-full glow-effect">
                Sluiten
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Back to Top Button */}
        {showBackToTop && (
          <Button
            onClick={scrollToTop}
            className="fixed bottom-4 right-4 rounded-full p-3 glow-effect"
            size="sm"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  if (currentScreen === 'admin') {
    const receiptTotal = selectedUserForReceipt
      ? selectedUserForReceipt.orders.reduce((sum, order) => sum + (order.price * order.quantity), 0)
      : 0;

    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted to-background p-4 animate-fade-in">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex justify-between items-center animate-slide-up">
            <div>
              <h1 className="text-3xl font-bold gradient-text">⚙️ Beheer</h1>
              <p className="text-sm text-muted-foreground">
                Ingelogd als {isMainAdmin ? 'hoofdbeheerder' : adminName}
              </p>
            </div>
            <Button onClick={() => setCurrentScreen('start')} variant="outline" className="bar-button">
              Terug naar start
            </Button>
          </div>

          {sandboxActive && (
            <Card className="bar-card border-destructive/40 animate-slide-up">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Testfase: je werkt met een kopie van de data</p>
                    <p className="text-sm text-muted-foreground">
                      Alles wat je hier doet (ook bestellen, tikkies, voorraad en gebruikers) wordt <strong>niet</strong> opgeslagen in de echte database. Gasten kunnen nu niet bestellen.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-muted-foreground">Bestelflow testen als</label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={testUserCode || users.filter(u => u.status !== 'pending')[0]?.code || ''}
                      onChange={(e) => setTestUserCode(e.target.value)}
                    >
                      {users.filter(u => u.status !== 'pending').map(u => (
                        <option key={u.id} value={u.code}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  <Button onClick={startTestOrder} disabled={loading} className="bar-button glow-effect">
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Bestelflow testen
                  </Button>
                  <Button onClick={resetSandbox} disabled={loading} variant="outline" className="bar-button">
                    Testdata resetten
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Slotcode + Onderhoudsmodus */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up">
            <Card className="bar-card">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Code voor het slot (deze week)
                  </p>
                  <p className="text-3xl font-bold tracking-[0.3em] gradient-text mt-1">
                    {getWeeklyLockCode()}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs whitespace-nowrap">Wisselt elke donderdag</Badge>
              </CardContent>
            </Card>

            <Card className="bar-card">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Testfase
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {testMode ? "Aan — gasten kunnen niet bestellen, jij werkt op een kopie" : "Uit — alles werkt met de echte data"}
                  </p>
                </div>
                <Switch
                  checked={testMode}
                  onCheckedChange={toggleTestMode}
                  disabled={loading || !can('settings')}
                />
              </CardContent>
            </Card>

            <Card className="bar-card">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Slotcode na bestelling
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {lockCodeEnabled ? "Aan — wordt getoond na elke bestelling" : "Uit — popup na bestelling is uitgeschakeld"}
                  </p>
                </div>
                <Switch
                  checked={lockCodeEnabled}
                  onCheckedChange={toggleLockCodeEnabled}
                  disabled={loading || !can('settings')}
                />
              </CardContent>
            </Card>

            <Card className="bar-card">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Onderhoudsmodus
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {maintenanceMode ? "Aan — zichtbaar op het inlogscherm" : "Uit — inlogscherm toont geen melding"}
                  </p>
                  <p className="text-xs text-muted-foreground">Bestellen blijft altijd mogelijk</p>
                </div>
                <Switch
                  checked={maintenanceMode}
                  onCheckedChange={toggleMaintenanceMode}
                  disabled={loading || !can('settings')}
                />
              </CardContent>
            </Card>
          </div>

          {/* Mobile Menu Toggle */}
          <div className="md:hidden">
            <Button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              variant="outline"
              className="w-full bar-button"
            >
              <Menu className="mr-2 h-4 w-4" />
              Menu
            </Button>
          </div>

          {/* Admin Menu */}
          <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up ${showMobileMenu ? 'block' : 'hidden md:grid'}`}>
            {can('users') && (
            <Button
              onClick={() => { setAdminSection('users'); loadUsers(); setShowMobileMenu(false); }}
              variant={adminSection === 'users' ? 'default' : 'outline'}
              className="h-20 bar-button relative"
            >
              <User className="mr-2 h-5 w-5" />
              Gebruikersbeheer
              {users.filter(u => u.status === 'pending').length > 0 && (
                <Badge variant="destructive" className="absolute -top-2 -right-2">
                  {users.filter(u => u.status === 'pending').length}
                </Badge>
              )}
            </Button>
            )}
            {can('products') && (
            <Button 
              onClick={() => { setAdminSection('products'); loadProducts(); setShowMobileMenu(false); }} 
              variant={adminSection === 'products' ? 'default' : 'outline'}
              className="h-20 bar-button"
            >
              <Package className="mr-2 h-5 w-5" />
              Voorraadbeheer
            </Button>
            )}
            {can('orders') && (
            <Button 
              onClick={() => { setAdminSection('orders'); loadOrders(); setShowMobileMenu(false); }} 
              variant={adminSection === 'orders' ? 'default' : 'outline'}
              className="h-20 bar-button"
            >
              <ShoppingCart className="mr-2 h-5 w-5" />
              Bestelgeschiedenis
            </Button>
            )}
            {can('revenue') && (
            <Button 
              onClick={() => { setAdminSection('revenue'); loadRevenueData(); setShowMobileMenu(false); }}
              variant={adminSection === 'revenue' ? 'default' : 'outline'}
              className="h-20 bar-button"
            >
              <BarChart3 className="mr-2 h-5 w-5" />
              Omzet
            </Button>
            )}
            {can('missing') && (
            <Button 
              onClick={() => { setAdminSection('missing'); loadMissingItems(); setShowMobileMenu(false); }} 
              variant={adminSection === 'missing' ? 'default' : 'outline'}
              className="h-20 bar-button"
            >
              <AlertTriangle className="mr-2 h-5 w-5" />
              Verdwenen goederen
            </Button>
            )}
            {can('settlements') && (
            <Button
              onClick={() => { setAdminSection('settlements'); loadSettlementData(); setShowMobileMenu(false); }}
              variant={adminSection === 'settlements' ? 'default' : 'outline'}
              className="h-20 bar-button relative"
            >
              <Wallet className="mr-2 h-5 w-5" />
              Tikkies
              {settlementItems.filter(i => !i.paid && settlements.some(st => st.id === i.settlement_id && new Date(st.due_at) <= new Date())).length > 0 && (
                <Badge variant="destructive" className="absolute -top-2 -right-2">
                  {settlementItems.filter(i => !i.paid && settlements.some(st => st.id === i.settlement_id && new Date(st.due_at) <= new Date())).length}
                </Badge>
              )}
            </Button>
            )}
            {isMainAdmin && (
              <Button
                onClick={() => { setAdminSection('admincodes'); loadAdminCodes(); setShowMobileMenu(false); }}
                variant={adminSection === 'admincodes' ? 'default' : 'outline'}
                className="h-20 bar-button"
              >
                <KeyRound className="mr-2 h-5 w-5" />
                Beheerders
              </Button>
            )}
          </div>

          {/* Admin Sections */}
          {adminSection === 'users' && can('users') && (
            <UserManagement
              users={filteredUsers.filter(u => u.status !== 'pending')}
              pendingUsers={users.filter(u => u.status === 'pending')}
              onAddUser={addUser}
              onDeleteUser={deleteUser}
              onApproveUser={approveUser}
              onRejectUser={rejectUser}
              searchQuery={userSearchQuery}
              onSearchChange={setUserSearchQuery}
              loading={loading}
            />
          )}

          {adminSection === 'products' && can('products') && (
            <ProductManagement 
              products={products} 
              onAddProduct={addProduct} 
              onUpdateStock={updateStock}
              onUpdateProduct={updateProduct}
              onDeleteProduct={deleteProduct}
              loading={loading}
            />
          )}

          {adminSection === 'orders' && can('orders') && (
            <OrderHistory 
              orders={orders.filter(o => !o.settlement_id)} 
              users={users} 
              onClearOrders={clearAllOrders}
              onGenerateReceipt={generateReceipt}
              loading={loading}
            />
          )}

          {adminSection === 'revenue' && can('revenue') && (
            <RevenueSection 
              monthlyRevenue={getMonthlyRevenue()} 
              productRevenue={getRevenueByProduct()}
              missingItemsLoss={getMissingItemsLoss()}
            />
          )}

          {adminSection === 'missing' && can('missing') && (
            <MissingItemsSection 
              missingItems={missingItems} 
              onReportMissing={() => setShowMissingItemDialog(true)}
              loading={loading}
            />
          )}

          {adminSection === 'settlements' && can('settlements') && (
            <SettlementSection
              currentOrders={orders.filter(o => !o.settlement_id)}
              users={users}
              settlements={settlements}
              items={settlementItems}
              onCreate={createSettlement}
              onSetPaid={setItemPaid}
              onUpdateDue={updateSettlementDue}
              loading={loading}
            />
          )}

          {adminSection === 'admincodes' && isMainAdmin && (
            <AdminCodeManagement
              adminCodes={adminCodes}
              onAdd={addAdminCode}
              onUpdatePermissions={updateAdminPermissions}
              onDelete={deleteAdminCode}
              loading={loading}
            />
          )}
        </div>

        {tikkieDialog}

        {/* Missing Item Dialog */}
        <Dialog open={showMissingItemDialog} onOpenChange={setShowMissingItemDialog}>
          <DialogContent className="bar-card">
            <DialogHeader>
              <DialogTitle>Verdwenen goederen rapporteren</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Product naam</label>
                <Input
                  value={missingItemForm.product_name}
                  onChange={(e) => setMissingItemForm(prev => ({ ...prev, product_name: e.target.value }))}
                  placeholder="Naam van het verdwenen product"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Hoeveelheid</label>
                <Input
                  type="number"
                  min="1"
                  value={missingItemForm.quantity}
                  onChange={(e) => setMissingItemForm(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Reden</label>
                <Textarea
                  value={missingItemForm.reason}
                  onChange={(e) => setMissingItemForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="Beschrijf waarom het product verdwenen is..."
                />
              </div>
              <div>
                <label className="text-sm font-medium">Gerapporteerd door</label>
                <Input
                  value={missingItemForm.reported_by}
                  onChange={(e) => setMissingItemForm(prev => ({ ...prev, reported_by: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMissingItemDialog(false)} disabled={loading}>
                Annuleren
              </Button>
              <Button onClick={reportMissingItem} disabled={loading} className="glow-effect">
                {loading ? "Rapporteren..." : "Rapporteren"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Receipt Dialog */}
        <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
          <DialogContent className="bar-card max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Kassabon
              </DialogTitle>
            </DialogHeader>
            {selectedUserForReceipt && (
              <div className="space-y-4">
                <div className="text-center border-b pb-4">
                  <h3 className="text-lg font-bold">🍺 BAR APP</h3>
                  <p className="text-sm text-muted-foreground">Kassabon</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="font-medium">Klant:</span>
                    <span>{selectedUserForReceipt.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Code:</span>
                    <span>{selectedUserForReceipt.code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Datum bon:</span>
                    <span>{new Date().toLocaleDateString('nl-NL', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {selectedUserForReceipt.orders.map(order => (
                    <div key={order.id} className="flex justify-between items-center text-sm">
                      <span className="flex-1">{order.name}</span>
                      <span className="w-12 text-center">{order.quantity}x</span>
                      <span className="w-16 text-right font-medium">€{(order.price * order.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="flex justify-between items-center font-bold text-lg">
                  <span>TOTAAL:</span>
                  <span>€{receiptTotal.toFixed(2)}</span>
                </div>

                <div className="text-center text-sm text-muted-foreground">
                  Bedankt voor uw bezoek! 🍻
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReceiptDialog(false)}>
                Sluiten
              </Button>
              <Button onClick={downloadReceipt} className="glow-effect" disabled={!selectedUserForReceipt}>
                <Download className="h-4 w-4 mr-2" />
                Downloaden
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Back to Top Button */}
        {showBackToTop && (
          <Button
            onClick={scrollToTop}
            className="fixed bottom-4 right-4 rounded-full p-3 glow-effect"
            size="sm"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return null;
};

// Component for User Management
const UserManagement = ({ users, pendingUsers, onAddUser, onDeleteUser, onApproveUser, onRejectUser, searchQuery, onSearchChange, loading }: {
  users: User[];
  pendingUsers: User[];
  onAddUser: (name: string, code: string) => void;
  onDeleteUser: (id: number) => void;
  onApproveUser: (id: number) => void;
  onRejectUser: (id: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  loading: boolean;
}) => {
  const [newUser, setNewUser] = useState({ name: '', code: '' });

  const handleAddUser = () => {
    if (newUser.name && newUser.code) {
      onAddUser(newUser.name, newUser.code);
      setNewUser({ name: '', code: '' });
    }
  };

  return (
    <div className="space-y-4">
      {pendingUsers.length > 0 && (
        <Card className="bar-card animate-slide-up border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Wachtend op goedkeuring ({pendingUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingUsers.map(user => (
              <div key={user.id} className="flex justify-between items-center p-3 border rounded-lg bg-destructive/5">
                <div>
                  <span className="font-medium">{user.name}</span>
                  <Badge variant="secondary" className="ml-2">{user.code}</Badge>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => onApproveUser(user.id)}
                    disabled={loading}
                    className="bar-button glow-effect"
                  >
                    Goedkeuren
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onRejectUser(user.id)}
                    disabled={loading}
                    className="bar-button"
                  >
                    Afwijzen
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card className="bar-card animate-slide-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Gebruikersbeheer ({users.length})
        </CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek gebruikers..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Laden...</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {users.map(user => (
              <div key={user.id} className="flex justify-between items-center p-3 border rounded-lg bg-card/50 backdrop-blur-sm">
                <div>
                  <span className="font-medium">{user.name}</span>
                  <Badge variant="secondary" className="ml-2">{user.code}</Badge>
                </div>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={() => onDeleteUser(user.id)}
                  disabled={loading}
                  className="bar-button"
                >
                  Verwijder
                </Button>
              </div>
            ))}
            {users.length === 0 && (
              <p className="text-center text-muted-foreground py-4">Geen gebruikers gevonden</p>
            )}
          </div>
        )}
        <Separator />
        <div className="space-y-3">
          <h4 className="font-medium">Nieuwe gebruiker</h4>
          <Input
            placeholder="Naam"
            value={newUser.name}
            onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))}
          />
          <Input
            placeholder="Code"
            value={newUser.code}
            onChange={(e) => setNewUser(prev => ({ ...prev, code: e.target.value }))}
          />
          <Button 
            onClick={handleAddUser} 
            className="w-full bar-button glow-effect"
            disabled={loading || !newUser.name || !newUser.code}
          >
            {loading ? "Toevoegen..." : "Toevoegen"}
          </Button>
        </div>
      </CardContent>
      </Card>
    </div>
  );
};

// Component for Product Management
const ProductManagement = ({ products, onAddProduct, onUpdateStock, onUpdateProduct, onDeleteProduct, loading }: {
  products: Product[];
  onAddProduct: (name: string, price: number, stock: number, description: string) => void;
  onUpdateStock: (id: number, stock: number) => void;
  onUpdateProduct: (id: number, updates: Partial<Product>) => void;
  onDeleteProduct: (id: number) => void;
  loading: boolean;
}) => {
  const [newProduct, setNewProduct] = useState({ name: '', price: 0, stock: 0, description: '' });
  const [stockUpdates, setStockUpdates] = useState<{ [key: number]: number }>({});
  const [expandedProduct, setExpandedProduct] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; price: number; description: string }>({ name: '', price: 0, description: '' });

  const handleAddProduct = () => {
    if (newProduct.name && newProduct.price > 0) {
      onAddProduct(newProduct.name, newProduct.price, newProduct.stock, newProduct.description);
      setNewProduct({ name: '', price: 0, stock: 0, description: '' });
    }
  };

  const handleStockUpdate = (productId: number) => {
    const newStock = stockUpdates[productId];
    if (newStock !== undefined) {
      onUpdateStock(productId, newStock);
    }
  };

  const startEditing = (product: Product) => {
    setEditingProduct(product.id);
    setEditForm({
      name: product.name,
      price: product.price,
      description: product.description || ''
    });
  };

  const cancelEditing = () => {
    setEditingProduct(null);
    setEditForm({ name: '', price: 0, description: '' });
  };

  const saveProduct = () => {
    if (editingProduct && editForm.name && editForm.price > 0) {
      onUpdateProduct(editingProduct, {
        name: editForm.name,
        price: editForm.price,
        description: editForm.description
      });
      setEditingProduct(null);
      setEditForm({ name: '', price: 0, description: '' });
    }
  };

  return (
    <Card className="bar-card animate-slide-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Voorraadbeheer ({products.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Laden...</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {products.map(product => (
              <div key={product.id} className="p-4 border rounded-lg bg-card/50 backdrop-blur-sm">
                {editingProduct === product.id ? (
                  // Edit Mode
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-muted-foreground">Product bewerken:</span>
                    </div>
                    <Input
                      placeholder="Product naam"
                      value={editForm.name}
                      onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                    />
                    <Textarea
                      placeholder="Beschrijving"
                      value={editForm.description}
                      onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                      rows={2}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Prijs (€)"
                      value={editForm.price || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                    />
                    <div className="flex gap-2">
                      <Button 
                        onClick={saveProduct}
                        disabled={loading || !editForm.name || editForm.price <= 0}
                        className="bar-button glow-effect"
                        size="sm"
                      >
                        Opslaan
                      </Button>
                      <Button 
                        onClick={cancelEditing}
                        variant="outline"
                        size="sm"
                        disabled={loading}
                      >
                        Annuleren
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-lg">{product.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                            className="h-6 w-6 p-0"
                          >
                            {expandedProduct === product.id ? '−' : '+'}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline">€{product.price.toFixed(2)}</Badge>
                          <Badge variant={product.stock <= 5 ? "destructive" : "secondary"}>
                            Voorraad: {product.stock}
                          </Badge>
                        </div>
                        {product.description && (
                          <p className="text-sm text-muted-foreground">{product.description}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => startEditing(product)}
                          disabled={loading}
                          className="bar-button"
                        >
                          ✏️
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm" 
                          onClick={() => onDeleteProduct(product.id)}
                          disabled={loading}
                          className="bar-button"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    
                    {expandedProduct === product.id && (
                      <div className="mt-3 pt-3 border-t">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Nieuwe voorraad:</span>
                          <Input
                            type="number"
                            className="w-24"
                            min="0"
                            defaultValue={product.stock}
                            onChange={(e) => setStockUpdates(prev => ({ 
                              ...prev, 
                              [product.id]: parseInt(e.target.value) || 0 
                            }))}
                          />
                          <Button 
                            size="sm" 
                            onClick={() => handleStockUpdate(product.id)}
                            disabled={loading}
                            className="bar-button"
                          >
                            Update
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {products.length === 0 && (
              <p className="text-center text-muted-foreground py-4">Geen producten gevonden</p>
            )}
          </div>
        )}
        <Separator />
        <div className="space-y-3">
          <h4 className="font-medium">Nieuw product</h4>
          <Input
            placeholder="Naam"
            value={newProduct.name}
            onChange={(e) => setNewProduct(prev => ({ ...prev, name: e.target.value }))}
          />
          <Textarea
            placeholder="Beschrijving (optioneel)"
            value={newProduct.description}
            onChange={(e) => setNewProduct(prev => ({ ...prev, description: e.target.value }))}
            rows={2}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Prijs (€)"
              value={newProduct.price || ''}
              onChange={(e) => setNewProduct(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              type="number"
              min="0"
              placeholder="Voorraad"
              value={newProduct.stock || ''}
              onChange={(e) => setNewProduct(prev => ({ ...prev, stock: parseInt(e.target.value) || 0 }))}
            />
          </div>
          <Button 
            onClick={handleAddProduct} 
            className="w-full bar-button glow-effect"
            disabled={loading || !newProduct.name || newProduct.price <= 0}
          >
            {loading ? "Toevoegen..." : "Product Toevoegen"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

// Component for Order History
const OrderHistory = ({ orders, users, onClearOrders, onGenerateReceipt, loading }: {
  orders: Order[];
  users: User[];
  onClearOrders: () => void;
  onGenerateReceipt: (userCode: string, userName: string, userOrders: Order[]) => void;
  loading: boolean;
}) => {
  const userMap = Object.fromEntries(users.map(u => [u.code, u.name]));
  const groupedOrders = orders.reduce((acc, order) => {
    if (!acc[order.user_code]) acc[order.user_code] = [];
    acc[order.user_code].push(order);
    return acc;
  }, {} as { [key: string]: Order[] });

  const totalRevenue = orders.reduce((sum, order) => sum + (order.price * order.quantity), 0);

  return (
    <Card className="bar-card animate-slide-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Bestelgeschiedenis ({orders.length} bestellingen)
        </CardTitle>
        <div className="flex justify-between items-center">
          <Badge variant="secondary" className="text-lg px-3 py-1">
            Totale omzet: €{totalRevenue.toFixed(2)}
          </Badge>
          <Button 
            variant="destructive" 
            onClick={onClearOrders} 
            disabled={loading}
            className="bar-button"
          >
            Verwijder alle bestellingen
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Laden...</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {Object.entries(groupedOrders).map(([userCode, userOrders]) => {
              const total = userOrders.reduce((sum, order) => sum + (order.price * order.quantity), 0);
              return (
                <div key={userCode} className="p-4 border rounded-lg bg-card/50 backdrop-blur-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-bold flex items-center gap-2">
                      <span>{userMap[userCode] || 'Onbekend'} ({userCode})</span>
                      <Badge variant="secondary">€{total.toFixed(2)}</Badge>
                    </h4>
                    <Button
                      onClick={() => onGenerateReceipt(userCode, userMap[userCode] || 'Onbekend', userOrders)}
                      size="sm"
                      variant="outline"
                      className="bar-button"
                      disabled={loading}
                    >
                      <Receipt className="h-4 w-4 mr-1" />
                      Bon
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {userOrders
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .map(order => (
                      <div key={order.id} className="flex justify-between items-center text-sm p-3 bg-muted/30 rounded">
                        <div className="flex-1">
                          <div className="flex justify-between items-center">
                            <span className="font-medium">{order.name} x {order.quantity}</span>
                            <span className="font-bold">€{(order.price * order.quantity).toFixed(2)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(order.created_at).toLocaleDateString('nl-NL', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {orders.length === 0 && (
              <p className="text-center text-muted-foreground py-8">Geen bestellingen gevonden</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Component for Revenue Section
const RevenueSection = ({ monthlyRevenue, productRevenue, missingItemsLoss }: {
  monthlyRevenue: { [key: string]: number };
  productRevenue: { [key: string]: number };
  missingItemsLoss: {
    lossData: { [key: string]: number };
    totalLoss: number;
    currentMonthLoss: number;
    monthlyLoss: { [key: string]: { year: number; month: number; loss: number } };
  };
}) => {
  const totalRevenue = Object.values(productRevenue).reduce((sum, revenue) => sum + revenue, 0);
  const netRevenue = totalRevenue - missingItemsLoss.totalLoss;

  const monthlyLossEntries = Object.values(missingItemsLoss.monthlyLoss).sort((a, b) =>
    b.year - a.year || b.month - a.month
  );
  const monthLabel = (year: number, month: number) =>
    new Date(year, month - 1).toLocaleDateString('nl-NL', { year: 'numeric', month: 'long' });

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="text-center">
        <h2 className="text-2xl font-bold gradient-text mb-4">📊 Omzet Overzicht</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-card/90 backdrop-blur-sm border border-border/70 rounded-xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Bruto Omzet</h3>
            <p className="text-2xl font-bold text-primary">€{totalRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-card/90 backdrop-blur-sm border border-border/70 rounded-xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Verlies deze maand</h3>
            <p className="text-2xl font-bold text-destructive">-€{missingItemsLoss.currentMonthLoss.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">Begint elke maand weer op €0,00</p>
          </div>
          <div className="bg-card/90 backdrop-blur-sm border border-border/70 rounded-xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Netto Omzet</h3>
            <p className="text-2xl font-bold text-success">€{netRevenue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <Card className="bar-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              📅 Maandelijkse omzet
              <Badge variant="outline" className="text-xs">Persistent</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">Deze gegevens blijven behouden, ook na het verwijderen van bestellingen</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {Object.entries(monthlyRevenue).map(([month, revenue]) => (
                <div key={month} className="flex justify-between items-center p-3 border rounded-lg bg-card/50">
                  <span className="font-medium">{month}</span>
                  <Badge variant="secondary" className="text-lg">€{revenue.toFixed(2)}</Badge>
                </div>
              ))}
              {Object.keys(monthlyRevenue).length === 0 && (
                <p className="text-center text-muted-foreground py-4">Geen omzetgegevens beschikbaar</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bar-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              📅 Verlies per maand
            </CardTitle>
            <p className="text-sm text-muted-foreground">De huidige maand begint steeds weer op €0,00; oudere maanden blijven zichtbaar</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {monthlyLossEntries.map(entry => (
                <div key={`${entry.year}-${entry.month}`} className="flex justify-between items-center p-3 border rounded-lg bg-destructive/5">
                  <span className="font-medium">{monthLabel(entry.year, entry.month)}</span>
                  <Badge variant="destructive" className="text-lg">-€{entry.loss.toFixed(2)}</Badge>
                </div>
              ))}
              {monthlyLossEntries.length === 0 && (
                <p className="text-center text-muted-foreground py-4">Geen verlies geregistreerd</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bar-card">
          <CardHeader>
            <CardTitle>Omzet per product</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {Object.entries(productRevenue)
                .sort(([,a], [,b]) => b - a)
                .map(([product, revenue]) => (
                <div key={product} className="flex justify-between items-center p-3 border rounded-lg bg-card/50">
                  <span className="font-medium">{product}</span>
                  <Badge variant="secondary" className="text-lg">€{revenue.toFixed(2)}</Badge>
                </div>
              ))}
              {Object.keys(productRevenue).length === 0 && (
                <p className="text-center text-muted-foreground py-4">Geen omzetgegevens beschikbaar</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bar-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Verlies per product (totaal)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {Object.entries(missingItemsLoss.lossData)
                .sort(([,a], [,b]) => b - a)
                .map(([product, loss]) => (
                <div key={product} className="flex justify-between items-center p-3 border rounded-lg bg-destructive/5">
                  <span className="font-medium">{product}</span>
                  <Badge variant="destructive" className="text-lg">-€{loss.toFixed(2)}</Badge>
                </div>
              ))}
              {Object.keys(missingItemsLoss.lossData).length === 0 && (
                <p className="text-center text-muted-foreground py-4">Geen verlies geregistreerd</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Card */}
      <Card className="bar-card">
        <CardHeader>
          <CardTitle>Financieel Overzicht</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="font-semibold text-lg">Inkomsten</h4>
              <div className="flex justify-between items-center p-3 bg-primary/10 rounded-lg">
                <span>Totale verkopen</span>
                <span className="font-bold text-primary">€{totalRevenue.toFixed(2)}</span>
              </div>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold text-lg">Verliezen</h4>
              <div className="flex justify-between items-center p-3 bg-destructive/10 rounded-lg">
                <span>Verdwenen goederen</span>
                <span className="font-bold text-destructive">-€{missingItemsLoss.totalLoss.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <Separator className="my-4" />
          <div className="flex justify-between items-center p-4 bg-success/10 rounded-lg">
            <span className="text-lg font-semibold">Netto Resultaat</span>
            <span className="text-2xl font-bold text-success">€{netRevenue.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Component for Missing Items Section
const MissingItemsSection = ({ missingItems, onReportMissing, loading }: {
  missingItems: MissingItem[];
  onReportMissing: () => void;
  loading: boolean;
}) => {
  return (
    <Card className="bar-card animate-slide-up">
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Verdwenen goederen ({missingItems.length})
          </span>
          <Button onClick={onReportMissing} disabled={loading} className="bar-button glow-effect">
            <AlertTriangle className="mr-2 h-4 w-4" />
            Rapporteer verdwenen
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Laden...</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {missingItems.map(item => (
              <div key={item.id} className="p-4 border rounded-lg bg-card/50 backdrop-blur-sm">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-medium text-lg">{item.product_name}</h4>
                  <Badge variant="destructive" className="text-sm">-{item.quantity}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-2 bg-muted/30 p-2 rounded">{item.reason}</p>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Door: <span className="font-medium">{item.reported_by}</span></span>
                  <span>{new Date(item.created_at).toLocaleDateString('nl-NL', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })} om {new Date(item.created_at).toLocaleTimeString('nl-NL', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}</span>
                </div>
              </div>
            ))}
            {missingItems.length === 0 && (
              <p className="text-center text-muted-foreground py-8">Geen verdwenen goederen geregistreerd</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ---------- Hulpjes voor betaaltermijnen ----------
const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatRemaining = (due: Date, now: Date) => {
  const ms = due.getTime() - now.getTime();
  if (ms <= 0) return 'Verlopen';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `Nog ${d} d ${h} u`;
  if (h > 0) return `Nog ${h} u ${m} min`;
  return `Nog ${m} min`;
};

// Component for Tikkie settlements
const SettlementSection = ({ currentOrders, users, settlements, items, onCreate, onSetPaid, onUpdateDue, loading }: {
  currentOrders: Order[];
  users: User[];
  settlements: Settlement[];
  items: SettlementItem[];
  onCreate: (dueAt: Date) => void;
  onSetPaid: (itemId: number, paid: boolean) => void;
  onUpdateDue: (settlementId: number, dueAt: Date) => void;
  loading: boolean;
}) => {
  const [now, setNow] = useState(() => new Date());
  const [dueInput, setDueInput] = useState(() => toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [dueEdits, setDueEdits] = useState<{ [id: number]: string }>({});

  // Houdt de aftelling en de "verlopen"-status actueel.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const userMap = Object.fromEntries(users.map(u => [u.code, u.name]));
  const standing = Object.entries(
    currentOrders.reduce((acc, o) => {
      acc[o.user_code] = (acc[o.user_code] || 0) + o.price * o.quantity;
      return acc;
    }, {} as { [code: string]: number })
  ).sort(([, a], [, b]) => b - a);
  const standingTotal = standing.reduce((sum, [, amount]) => sum + amount, 0);

  return (
    <div className="space-y-6 animate-slide-up">
      <Card className="bar-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Huidige stand vastzetten
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Zet de openstaande bedragen vast voor de tikkies. De lopende bestelgeschiedenis begint daarna opnieuw.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {standing.length === 0 ? (
            <p className="text-center text-muted-foreground py-2">Geen openstaande bestellingen</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {standing.map(([code, amount]) => (
                <div key={code} className="flex justify-between items-center p-3 border rounded-lg bg-card/50">
                  <span className="font-medium">{userMap[code] || 'Onbekend'} <span className="text-xs text-muted-foreground">({code})</span></span>
                  <Badge variant="secondary" className="text-base">€{amount.toFixed(2)}</Badge>
                </div>
              ))}
              <div className="flex justify-between items-center p-3 bg-primary/10 rounded-lg font-semibold">
                <span>Totaal</span>
                <span>€{standingTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4" />
                Betalen vóór
              </label>
              <Input
                type="datetime-local"
                value={dueInput}
                onChange={(e) => setDueInput(e.target.value)}
              />
            </div>
            <Button
              onClick={() => onCreate(new Date(dueInput))}
              disabled={loading || standing.length === 0 || !dueInput}
              className="bar-button glow-effect"
            >
              Stand vastzetten
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Wie na deze datum nog niet is afgevinkt als betaald, kan niet meer bestellen en krijgt de melding om eerst de tikkie te betalen.
          </p>
        </CardContent>
      </Card>

      {settlements.length === 0 && (
        <p className="text-center text-muted-foreground py-4">Nog geen afrekeningen vastgezet</p>
      )}

      {settlements.map(st => {
        const stItems = items.filter(i => i.settlement_id === st.id);
        const due = new Date(st.due_at);
        const overdue = due <= now;
        const total = stItems.reduce((sum, i) => sum + Number(i.amount), 0);
        const open = stItems.filter(i => !i.paid).reduce((sum, i) => sum + Number(i.amount), 0);
        const editValue = dueEdits[st.id] ?? toLocalInput(due);
        const dueChanged = editValue !== toLocalInput(due);

        return (
          <Card key={st.id} className="bar-card">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Afrekening van {new Date(st.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
                {open === 0 ? (
                  <Badge variant="secondary">Alles betaald</Badge>
                ) : (
                  <Badge variant={overdue ? 'destructive' : 'outline'} className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRemaining(due, now)}
                  </Badge>
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Totaal €{total.toFixed(2)} · nog open €{open.toFixed(2)}
              </p>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2 pt-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground">Betalen vóór</label>
                  <Input
                    type="datetime-local"
                    value={editValue}
                    onChange={(e) => setDueEdits(prev => ({ ...prev, [st.id]: e.target.value }))}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || !dueChanged}
                  onClick={() => {
                    onUpdateDue(st.id, new Date(editValue));
                    setDueEdits(prev => { const { [st.id]: _removed, ...rest } = prev; return rest; });
                  }}
                >
                  Termijn opslaan
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stItems.map(item => {
                  const blocked = !item.paid && overdue;
                  return (
                    <div
                      key={item.id}
                      className={`flex justify-between items-center p-3 border rounded-lg ${blocked ? 'bg-destructive/5 border-destructive/40' : 'bg-card/50'}`}
                    >
                      <div>
                        <span className="font-medium">{item.user_name}</span>
                        <span className="ml-2 text-sm text-muted-foreground">€{Number(item.amount).toFixed(2)}</span>
                        {blocked && <Badge variant="destructive" className="ml-2">Geblokkeerd</Badge>}
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        {item.paid ? 'Betaald' : 'Niet betaald'}
                        <Switch
                          checked={item.paid}
                          onCheckedChange={(checked) => onSetPaid(item.id, checked)}
                          disabled={loading}
                        />
                      </label>
                    </div>
                  );
                })}
                {stItems.length === 0 && (
                  <p className="text-center text-muted-foreground py-2">Geen bedragen in deze afrekening</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

// Component for extra admin codes (only the main admin sees this)
const AdminCodeManagement = ({ adminCodes, onAdd, onUpdatePermissions, onDelete, loading }: {
  adminCodes: AdminCode[];
  onAdd: (name: string, code: string, permissions: string[]) => void;
  onUpdatePermissions: (id: number, permissions: string[]) => void;
  onDelete: (id: number) => void;
  loading: boolean;
}) => {
  const [form, setForm] = useState({ name: '', code: '' });
  const [newPermissions, setNewPermissions] = useState<string[]>(ALL_PERMISSIONS);

  const toggle = (list: string[], key: string, on: boolean) =>
    on ? [...new Set([...list, key])] : list.filter(k => k !== key);

  return (
    <Card className="bar-card animate-slide-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Beheerders ({adminCodes.length + 1})
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Jij blijft hoofdbeheerder en kunt alles. Per beheerder bepaal je hieronder welke onderdelen die mag gebruiken. Beheercodes aanmaken of verwijderen kan alleen jij.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex justify-between items-center p-3 border rounded-lg bg-primary/10">
            <span className="font-medium">Hoofdbeheerder</span>
            <Badge variant="secondary">Jij · alle rechten</Badge>
          </div>
          {adminCodes.map(a => {
            const perms = Array.isArray(a.permissions) ? a.permissions : ALL_PERMISSIONS;
            return (
              <div key={a.id} className="p-3 border rounded-lg bg-card/50 space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-medium">{a.name}</span>
                    <Badge variant="secondary" className="ml-2">{a.code}</Badge>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => onDelete(a.id)} disabled={loading} className="bar-button">
                    Verwijder
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ADMIN_PERMISSIONS.map(perm => (
                    <label key={perm.key} className="flex items-center justify-between gap-2 text-sm p-2 rounded bg-muted/30">
                      {perm.label}
                      <Switch
                        checked={perms.includes(perm.key)}
                        onCheckedChange={(on) => onUpdatePermissions(a.id, toggle(perms, perm.key, on))}
                        disabled={loading}
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {adminCodes.length === 0 && (
            <p className="text-center text-muted-foreground py-2">Nog geen extra beheerders</p>
          )}
        </div>
        <Separator />
        <div className="space-y-3">
          <h4 className="font-medium">Nieuwe beheerder</h4>
          <Input
            placeholder="Naam"
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
          />
          <Input
            placeholder="Beheercode"
            value={form.code}
            onChange={(e) => setForm(prev => ({ ...prev, code: e.target.value }))}
          />
          <p className="text-sm font-medium">Wat mag deze beheerder?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ADMIN_PERMISSIONS.map(perm => (
              <label key={perm.key} className="flex items-center justify-between gap-2 text-sm p-2 rounded bg-muted/30">
                {perm.label}
                <Switch
                  checked={newPermissions.includes(perm.key)}
                  onCheckedChange={(on) => setNewPermissions(prev => toggle(prev, perm.key, on))}
                />
              </label>
            ))}
          </div>
          <Button
            onClick={() => { onAdd(form.name, form.code, newPermissions); setForm({ name: '', code: '' }); }}
            className="w-full bar-button glow-effect"
            disabled={loading || !form.name.trim() || !form.code.trim()}
          >
            Beheercode aanmaken
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default Index;
