import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Minus, ShoppingCart, User, Package, BarChart3, AlertTriangle, ArrowUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface User {
  id: number;
  name: string;
  code: string;
}

interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
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
}

interface MissingItem {
  id: number;
  product_name: string;
  quantity: number;
  reason: string;
  reported_by: string;
  created_at: string;
}

const Index = () => {
  const [currentScreen, setCurrentScreen] = useState<'start' | 'order' | 'admin'>('start');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [missingItems, setMissingItems] = useState<MissingItem[]>([]);
  const [adminSection, setAdminSection] = useState<string>('');
  const [showConfirmOrder, setShowConfirmOrder] = useState(false);
  const [showMissingItemDialog, setShowMissingItemDialog] = useState(false);
  const [missingItemForm, setMissingItemForm] = useState({
    product_name: '',
    quantity: 1,
    reason: '',
    reported_by: 'Admin'
  });
  const [showBackToTop, setShowBackToTop] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const promptUserCode = async () => {
    const code = prompt("Voer je gebruikerscode in:");
    if (code) {
      const { data } = await supabase
        .from('users_2025_10_08_19_41')
        .select('*')
        .eq('code', code)
        .single();
      
      if (data) {
        setCurrentUser(data);
        loadOrderScreen();
      } else {
        toast({
          title: "Fout",
          description: "Ongeldige gebruikerscode",
          variant: "destructive"
        });
      }
    }
  };

  const promptAdminCode = () => {
    const code = prompt("Voer de beheercode in:");
    if (code === 'BHV123') {
      setCurrentScreen('admin');
      setAdminSection('');
    } else {
      toast({
        title: "Fout",
        description: "Ongeldige beheercode",
        variant: "destructive"
      });
    }
  };

  const loadOrderScreen = async () => {
    const { data } = await supabase.from('products_2025_10_08_19_41').select('*');
    setProducts(data || []);
    setCurrentScreen('order');
    setCart([]);
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

    try {
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

        // Update stock
        await supabase
          .from('products_2025_10_08_19_41')
          .update({ stock: product.stock - item.quantity })
          .eq('id', item.id);

        // Insert order
        await supabase
          .from('orders_2025_10_08_19_41')
          .insert({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            user_code: currentUser.code
          });
      }

      toast({
        title: "Succes",
        description: "Bestelling geplaatst!"
      });

      setCart([]);
      setShowConfirmOrder(false);
      setCurrentScreen('start');
      setCurrentUser(null);
    } catch (error) {
      toast({
        title: "Fout",
        description: "Er ging iets mis bij het plaatsen van de bestelling",
        variant: "destructive"
      });
    }
  };

  const loadUsers = async () => {
    const { data } = await supabase.from('users_2025_10_08_19_41').select('*');
    setUsers(data || []);
  };

  const loadOrders = async () => {
    const { data } = await supabase.from('orders_2025_10_08_19_41').select('*');
    setOrders(data || []);
  };

  const loadMissingItems = async () => {
    const { data } = await supabase.from('missing_items_2025_10_08_19_41').select('*');
    setMissingItems(data || []);
  };

  const addUser = async (name: string, code: string) => {
    await supabase.from('users_2025_10_08_19_41').insert({ name, code });
    loadUsers();
    toast({ title: "Succes", description: "Gebruiker toegevoegd" });
  };

  const deleteUser = async (id: number) => {
    await supabase.from('users_2025_10_08_19_41').delete().eq('id', id);
    loadUsers();
    toast({ title: "Succes", description: "Gebruiker verwijderd" });
  };

  const addProduct = async (name: string, price: number, stock: number) => {
    await supabase.from('products_2025_10_08_19_41').insert({ name, price, stock });
    const { data } = await supabase.from('products_2025_10_08_19_41').select('*');
    setProducts(data || []);
    toast({ title: "Succes", description: "Product toegevoegd" });
  };

  const updateStock = async (id: number, stock: number) => {
    await supabase.from('products_2025_10_08_19_41').update({ stock }).eq('id', id);
    const { data } = await supabase.from('products_2025_10_08_19_41').select('*');
    setProducts(data || []);
    toast({ title: "Succes", description: "Voorraad bijgewerkt" });
  };

  const reportMissingItem = async () => {
    await supabase.from('missing_items_2025_10_08_19_41').insert(missingItemForm);
    
    // Update product stock if product exists
    const product = products.find(p => p.name === missingItemForm.product_name);
    if (product) {
      await supabase
        .from('products_2025_10_08_19_41')
        .update({ stock: Math.max(0, product.stock - missingItemForm.quantity) })
        .eq('id', product.id);
      
      const { data } = await supabase.from('products_2025_10_08_19_41').select('*');
      setProducts(data || []);
    }

    setMissingItemForm({ product_name: '', quantity: 1, reason: '', reported_by: 'Admin' });
    setShowMissingItemDialog(false);
    loadMissingItems();
    toast({ title: "Succes", description: "Verdwenen goederen geregistreerd" });
  };

  const clearAllOrders = async () => {
    if (confirm("Weet je zeker dat je alle bestellingen wilt verwijderen?")) {
      await supabase.from('orders_2025_10_08_19_41').delete().neq('id', 0);
      loadOrders();
      toast({ title: "Succes", description: "Alle bestellingen verwijderd" });
    }
  };

  const getMonthlyRevenue = () => {
    const monthlyData: { [key: string]: number } = {};
    orders.forEach(order => {
      const month = new Date(order.created_at).toLocaleDateString('nl-NL', { year: 'numeric', month: 'long' });
      monthlyData[month] = (monthlyData[month] || 0) + (order.price * order.quantity);
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

  if (currentScreen === 'start') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-2xl">Welkom</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={promptUserCode} className="w-full" size="lg">
              <ShoppingCart className="mr-2 h-5 w-5" />
              Bestellen
            </Button>
            <Button onClick={promptAdminCode} variant="outline" className="w-full" size="lg">
              <User className="mr-2 h-5 w-5" />
              Beheer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentScreen === 'order') {
    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header with user name */}
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold">Bestellen</h1>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5" />
              <span className="font-medium">{currentUser?.name}</span>
            </div>
          </div>

          {/* Products */}
          <Card>
            <CardHeader>
              <CardTitle>Producten</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {products.map(product => (
                <div key={product.id} className="flex justify-between items-center p-3 border rounded-lg">
                  <div>
                    <h3 className="font-medium">{product.name}</h3>
                    <p className="text-sm text-gray-600">€{product.price.toFixed(2)} - Voorraad: {product.stock}</p>
                  </div>
                  <Button 
                    onClick={() => addToCart(product)} 
                    disabled={product.stock === 0}
                    size="sm"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Shopping Cart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Winkelwagentje
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <p className="text-gray-500 text-center py-4">Je winkelwagentje is leeg</p>
              ) : (
                <div className="space-y-3">
                  {cart.map(item => (
                    <div key={item.id} className="flex justify-between items-center p-3 border rounded-lg">
                      <div>
                        <h4 className="font-medium">{item.name}</h4>
                        <p className="text-sm text-gray-600">€{item.price.toFixed(2)} per stuk</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => updateCartQuantity(item.id, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="mx-2 font-medium">{item.quantity}</span>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => updateCartQuantity(item.id, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive"
                          onClick={() => removeFromCart(item.id)}
                          className="ml-2"
                        >
                          ✖
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between items-center font-bold text-lg">
                    <span>Totaal:</span>
                    <span>€{cartTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="space-y-3">
            <Button onClick={confirmOrder} className="w-full" size="lg" disabled={cart.length === 0}>
              Bevestig bestelling
            </Button>
            <Button 
              onClick={() => { setCurrentScreen('start'); setCurrentUser(null); setCart([]); }} 
              variant="outline" 
              className="w-full"
            >
              Terug
            </Button>
          </div>
        </div>

        {/* Confirmation Dialog */}
        <Dialog open={showConfirmOrder} onOpenChange={setShowConfirmOrder}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bestelling bevestigen</DialogTitle>
              <DialogDescription>
                Weet je zeker dat je deze bestelling wilt plaatsen?
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <h4 className="font-medium mb-2">Overzicht:</h4>
              {cart.map(item => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>{item.name} x {item.quantity}</span>
                  <span>€{(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
              <Separator className="my-2" />
              <div className="flex justify-between font-bold">
                <span>Totaal:</span>
                <span>€{cartTotal.toFixed(2)}</span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirmOrder(false)}>
                Nee, annuleren
              </Button>
              <Button onClick={placeOrder}>
                Ja, bevestigen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Back to Top Button */}
        {showBackToTop && (
          <Button
            onClick={scrollToTop}
            className="fixed bottom-4 right-4 rounded-full p-3"
            size="sm"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  if (currentScreen === 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold">Beheer</h1>
            <Button onClick={() => setCurrentScreen('start')} variant="outline">
              Terug
            </Button>
          </div>

          {/* Admin Menu */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Button 
              onClick={() => { setAdminSection('users'); loadUsers(); }} 
              variant={adminSection === 'users' ? 'default' : 'outline'}
              className="h-20"
            >
              <User className="mr-2 h-5 w-5" />
              Gebruikersbeheer
            </Button>
            <Button 
              onClick={() => { setAdminSection('products'); }} 
              variant={adminSection === 'products' ? 'default' : 'outline'}
              className="h-20"
            >
              <Package className="mr-2 h-5 w-5" />
              Voorraadbeheer
            </Button>
            <Button 
              onClick={() => { setAdminSection('orders'); loadOrders(); }} 
              variant={adminSection === 'orders' ? 'default' : 'outline'}
              className="h-20"
            >
              <ShoppingCart className="mr-2 h-5 w-5" />
              Bestelgeschiedenis
            </Button>
            <Button 
              onClick={() => { setAdminSection('revenue'); loadOrders(); }} 
              variant={adminSection === 'revenue' ? 'default' : 'outline'}
              className="h-20"
            >
              <BarChart3 className="mr-2 h-5 w-5" />
              Omzet
            </Button>
            <Button 
              onClick={() => { setAdminSection('missing'); loadMissingItems(); }} 
              variant={adminSection === 'missing' ? 'default' : 'outline'}
              className="h-20"
            >
              <AlertTriangle className="mr-2 h-5 w-5" />
              Verdwenen goederen
            </Button>
          </div>

          {/* Admin Sections */}
          {adminSection === 'users' && (
            <UserManagement 
              users={users} 
              onAddUser={addUser} 
              onDeleteUser={deleteUser} 
            />
          )}

          {adminSection === 'products' && (
            <ProductManagement 
              products={products} 
              onAddProduct={addProduct} 
              onUpdateStock={updateStock} 
            />
          )}

          {adminSection === 'orders' && (
            <OrderHistory 
              orders={orders} 
              users={users} 
              onClearOrders={clearAllOrders} 
            />
          )}

          {adminSection === 'revenue' && (
            <RevenueSection 
              monthlyRevenue={getMonthlyRevenue()} 
              productRevenue={getRevenueByProduct()} 
            />
          )}

          {adminSection === 'missing' && (
            <MissingItemsSection 
              missingItems={missingItems} 
              onReportMissing={() => setShowMissingItemDialog(true)} 
            />
          )}
        </div>

        {/* Missing Item Dialog */}
        <Dialog open={showMissingItemDialog} onOpenChange={setShowMissingItemDialog}>
          <DialogContent>
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
              <Button variant="outline" onClick={() => setShowMissingItemDialog(false)}>
                Annuleren
              </Button>
              <Button onClick={reportMissingItem}>
                Rapporteren
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return null;
};

// Component for User Management
const UserManagement = ({ users, onAddUser, onDeleteUser }: {
  users: User[];
  onAddUser: (name: string, code: string) => void;
  onDeleteUser: (id: number) => void;
}) => {
  const [newUser, setNewUser] = useState({ name: '', code: '' });

  const handleAddUser = () => {
    if (newUser.name && newUser.code) {
      onAddUser(newUser.name, newUser.code);
      setNewUser({ name: '', code: '' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gebruikersbeheer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {users.map(user => (
            <div key={user.id} className="flex justify-between items-center p-3 border rounded-lg">
              <div>
                <span className="font-medium">{user.name}</span>
                <Badge variant="secondary" className="ml-2">{user.code}</Badge>
              </div>
              <Button variant="destructive" size="sm" onClick={() => onDeleteUser(user.id)}>
                Verwijder
              </Button>
            </div>
          ))}
        </div>
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
          <Button onClick={handleAddUser} className="w-full">
            Toevoegen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

// Component for Product Management
const ProductManagement = ({ products, onAddProduct, onUpdateStock }: {
  products: Product[];
  onAddProduct: (name: string, price: number, stock: number) => void;
  onUpdateStock: (id: number, stock: number) => void;
}) => {
  const [newProduct, setNewProduct] = useState({ name: '', price: 0, stock: 0 });
  const [stockUpdates, setStockUpdates] = useState<{ [key: number]: number }>({});

  const handleAddProduct = () => {
    if (newProduct.name && newProduct.price > 0) {
      onAddProduct(newProduct.name, newProduct.price, newProduct.stock);
      setNewProduct({ name: '', price: 0, stock: 0 });
    }
  };

  const handleStockUpdate = (productId: number) => {
    const newStock = stockUpdates[productId];
    if (newStock !== undefined) {
      onUpdateStock(productId, newStock);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voorraadbeheer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {products.map(product => (
            <div key={product.id} className="p-3 border rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">{product.name}</span>
                <Badge variant="outline">€{product.price.toFixed(2)}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Voorraad:</span>
                <Input
                  type="number"
                  className="w-20"
                  defaultValue={product.stock}
                  onChange={(e) => setStockUpdates(prev => ({ 
                    ...prev, 
                    [product.id]: parseInt(e.target.value) || 0 
                  }))}
                />
                <Button size="sm" onClick={() => handleStockUpdate(product.id)}>
                  Update
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Separator />
        <div className="space-y-3">
          <h4 className="font-medium">Nieuw product</h4>
          <Input
            placeholder="Naam"
            value={newProduct.name}
            onChange={(e) => setNewProduct(prev => ({ ...prev, name: e.target.value }))}
          />
          <Input
            type="number"
            step="0.01"
            placeholder="Prijs"
            value={newProduct.price || ''}
            onChange={(e) => setNewProduct(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
          />
          <Input
            type="number"
            placeholder="Voorraad"
            value={newProduct.stock || ''}
            onChange={(e) => setNewProduct(prev => ({ ...prev, stock: parseInt(e.target.value) || 0 }))}
          />
          <Button onClick={handleAddProduct} className="w-full">
            Toevoegen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

// Component for Order History
const OrderHistory = ({ orders, users, onClearOrders }: {
  orders: Order[];
  users: User[];
  onClearOrders: () => void;
}) => {
  const userMap = Object.fromEntries(users.map(u => [u.code, u.name]));
  const groupedOrders = orders.reduce((acc, order) => {
    if (!acc[order.user_code]) acc[order.user_code] = [];
    acc[order.user_code].push(order);
    return acc;
  }, {} as { [key: string]: Order[] });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bestelgeschiedenis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(groupedOrders).map(([userCode, userOrders]) => {
          const total = userOrders.reduce((sum, order) => sum + (order.price * order.quantity), 0);
          return (
            <div key={userCode} className="p-4 border rounded-lg">
              <h4 className="font-bold mb-2">
                {userMap[userCode] || 'Onbekend'} ({userCode})
              </h4>
              <div className="space-y-1 text-sm">
                {userOrders.map(order => (
                  <div key={order.id} className="flex justify-between">
                    <span>{order.name} x {order.quantity}</span>
                    <span>€{(order.price * order.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-bold">
                <span>Totaal:</span>
                <span>€{total.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
        <Button variant="destructive" onClick={onClearOrders} className="w-full">
          Verwijder alle bestellingen
        </Button>
      </CardContent>
    </Card>
  );
};

// Component for Revenue Section
const RevenueSection = ({ monthlyRevenue, productRevenue }: {
  monthlyRevenue: { [key: string]: number };
  productRevenue: { [key: string]: number };
}) => {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Maandelijkse omzet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(monthlyRevenue).map(([month, revenue]) => (
              <div key={month} className="flex justify-between items-center p-2 border rounded">
                <span>{month}</span>
                <Badge variant="secondary">€{revenue.toFixed(2)}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Omzet per product</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(productRevenue).map(([product, revenue]) => (
              <div key={product} className="flex justify-between items-center p-2 border rounded">
                <span>{product}</span>
                <Badge variant="secondary">€{revenue.toFixed(2)}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Component for Missing Items Section
const MissingItemsSection = ({ missingItems, onReportMissing }: {
  missingItems: MissingItem[];
  onReportMissing: () => void;
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          Verdwenen goederen
          <Button onClick={onReportMissing}>
            <AlertTriangle className="mr-2 h-4 w-4" />
            Rapporteer verdwenen
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {missingItems.map(item => (
            <div key={item.id} className="p-3 border rounded-lg">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium">{item.product_name}</h4>
                <Badge variant="destructive">-{item.quantity}</Badge>
              </div>
              <p className="text-sm text-gray-600 mb-1">{item.reason}</p>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Door: {item.reported_by}</span>
                <span>{new Date(item.created_at).toLocaleDateString('nl-NL')}</span>
              </div>
            </div>
          ))}
          {missingItems.length === 0 && (
            <p className="text-center text-gray-500 py-4">Geen verdwenen goederen geregistreerd</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default Index;