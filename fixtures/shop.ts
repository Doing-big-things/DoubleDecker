// The M0 design fixture: an imagined shop service, written by hand to exercise
// every element of the upper deck. It is not extracted from code.
import type { DeckBundle } from '@decker/deck-model';
import { DeckBuilder, op } from './dsl.ts';

export function buildShop(): DeckBundle {
  const d = new DeckBuilder('shop');

  d.area('HTTP', () => {
    d.block('Server', {
      summary: 'Starts the HTTP listener and wires the routes',
      path: 'src/http/server.ts',
      tags: ['entry'],
      uses: ['node:http'],
      ops: [
        op('start(config: Config): Promise<Server>', 'Start listening on the configured port', {
          calls: ['Router.mount', 'Config.load', 'Logger.info'],
          tests: ['listens on the configured port', 'refuses to start twice'],
        }),
        op('stop(): Promise<void>', 'Drain in-flight requests, then stop', { tests: ['waits for open requests'] }),
      ],
    });
    d.block('Router', {
      summary: 'Matches requests to route handlers',
      path: 'src/http/router.ts',
      gaps: ['dynamic-call', 'dynamic-call'],
      notes: ['◦ Looks handlers up by a string key built at runtime'],
      ops: [
        op('mount(routes: RouteTable): void', 'Register a table of routes', { tests: ['registers every route', 'rejects a duplicate path'] }),
        op('dispatch(req: Request): Promise<Response>', 'Find the handler for a request and run it', {
          calls: ['Auth.authenticate', 'ErrorHandler.toResponse', 'OrdersRoutes.postOrder', 'CatalogRoutes.listProducts', 'InventoryRoutes.getStock'],
          tests: ['runs the matching handler', 'answers 404 for an unknown path', 'answers 405 for a wrong method', 'passes path parameters through'],
        }),
      ],
    });
    d.block('Auth', {
      summary: 'Checks who is calling',
      path: 'src/http/auth.ts',
      uses: ['node:crypto'],
      ops: [
        op('authenticate(req: Request): Session', 'Reject requests without a valid session token', {
          calls: ['Config.get'],
          tests: ['accepts a valid token', 'rejects a missing token', 'rejects an expired token'],
        }),
        op('requireRole(session: Session, role: Role): void', 'Require a role for admin routes', {
          tests: ['lets an admin through', 'stops a customer'],
        }),
      ],
    });
    d.block('ErrorHandler', {
      summary: 'Turns failures into HTTP responses',
      path: 'src/http/error-handler.ts',
      usesTypes: ['Result'],
      ops: [
        op('toResponse(error: unknown): Response', 'Map a domain error to a status code and body', {
          calls: ['Logger.error'],
          tests: ['maps not-found to 404', 'maps validation to 422', 'hides internal detail on 500', 'logs unexpected errors'],
        }),
      ],
    });
    d.block('OrdersRoutes', {
      summary: 'HTTP surface for orders',
      path: 'src/http/orders-routes.ts',
      ops: [
        op('postOrder(req: Request): Promise<Response>', "Place an order from the caller's cart", {
          tags: ['api'],
          calls: ['Cart.get'],
          api: { 'Orders.placeOrder': 'place order' },
          tests: ['answers 201 with the new order', 'answers 422 for an empty cart'],
        }),
        op('getOrder(req: Request): Promise<Response>', 'Show one order', {
          tags: ['api'],
          api: { 'Orders.getOrder': 'get order' },
          tests: ['answers 404 for an unknown order', "hides another customer's order"],
        }),
        op('cancelOrder(req: Request): Promise<Response>', 'Cancel an order that has not shipped', {
          tags: ['api'],
          api: { 'Orders.cancelOrder': 'cancel order' },
          tests: ['answers 409 once shipped'],
        }),
      ],
    });
    d.block('CatalogRoutes', {
      summary: 'HTTP surface for browsing products',
      path: 'src/http/catalog-routes.ts',
      ops: [
        op('listProducts(req: Request): Promise<Response>', 'List products, a page at a time', {
          tags: ['api'],
          api: { 'Catalog.list': 'list' },
          tests: ['returns the first page by default', 'caps the page size'],
        }),
        op('getProduct(req: Request): Promise<Response>', 'Show one product with its stock level', {
          tags: ['api'],
          calls: ['Inventory.available'],
          api: { 'Catalog.get': 'get' },
          tests: ['includes availability'],
        }),
        op('search(req: Request): Promise<Response>', 'Search products by text', {
          tags: ['api'],
          calls: ['Search.query'],
          tests: ['answers 400 for an empty phrase'],
        }),
      ],
    });
    d.block('InventoryRoutes', {
      summary: 'Admin surface for stock',
      path: 'src/http/inventory-routes.ts',
      ops: [
        op('getStock(req: Request): Promise<Response>', 'Report stock for a product', { tags: ['api'], api: { 'Inventory.available': 'available' } }),
        op('restock(req: Request): Promise<Response>', 'Record a delivery of new stock', {
          tags: ['api'],
          calls: ['Auth.requireRole'],
          api: { 'Restock.receive': 'receive' },
        }),
      ],
    });
  });

  d.area('Orders', () => {
    d.block('Orders', {
      summary: 'Places, tracks and cancels customer orders',
      path: 'src/orders/index.ts',
      notes: ['▪ Never confirm an order that has not been paid'],
      data: ['interface Order', 'type OrderStatus', 'type OrderId'],
      usesTypes: ['Money'],
      ops: [
        op('placeOrder(cart: Cart, customer: CustomerId): Promise<Order>', 'Place an order from a cart', {
          calls: ['Checkout.run', 'OrderRepository.save', 'OrderEvents.placed'],
          tests: ['places an order for a valid cart', 'rejects an empty cart', 'does not save when payment fails', 'announces the new order', 'gives each order a fresh id'],
        }),
        op('getOrder(id: OrderId): Promise<Order>', 'Look up one order', { calls: ['OrderRepository.find'], tests: ['returns the order', 'fails for an unknown id'] }),
        op('cancelOrder(id: OrderId, reason: string): Promise<Order>', 'Cancel an order that has not shipped', {
          calls: ['OrderRepository.find', 'OrderRepository.save', 'Refunds.refund', 'OrderEvents.cancelled'],
          tests: ['cancels a paid order', 'refunds the customer', 'refuses once shipped'],
        }),
        op('listOrders(customer: CustomerId): Promise<Order[]>', "List a customer's orders, newest first", {
          calls: ['OrderRepository.byCustomer'],
          tests: ['sorts newest first', 'returns nothing for a new customer'],
        }),
      ],
    });
    d.block('Cart', {
      summary: 'Holds what a customer intends to buy',
      path: 'src/orders/cart.ts',
      data: ['interface Cart', 'interface LineItem'],
      notes: ['◦ Caps the quantity of any one item at 99'],
      ops: [
        op('get(customer: CustomerId): Cart', "Fetch the customer's open cart", { tests: ['creates a cart on first use'] }),
        op('addItem(cart: Cart, sku: Sku, quantity: number): Cart', 'Add an item, merging duplicates', {
          calls: ['Products.get'],
          tests: ['adds a new line', 'merges a repeated item', 'rejects a discontinued product', 'caps the quantity'],
        }),
        op('removeItem(cart: Cart, sku: Sku): Cart', 'Remove an item', { tests: ['removes the line', 'ignores an item that is not there'] }),
        op('clear(cart: Cart): Cart', 'Empty the cart after checkout', { tests: ['leaves an empty cart'] }),
      ],
    });
    d.block('Checkout', {
      summary: 'Prices a cart and takes payment',
      path: 'src/orders/checkout.ts',
      data: ['interface Receipt'],
      ops: [
        op('run(cart: Cart, customer: CustomerId): Promise<Receipt>', 'Price the cart, charge the customer, and return a receipt', {
          calls: ['Pricing.total', 'Payments.charge', 'Cart.clear'],
          api: { 'Inventory.reserve': 'reserve' },
          tests: ['charges the cart total', 'reserves stock before charging', '!releases stock when the charge fails', 'clears the cart afterwards', '!does not charge twice on retry'],
        }),
        op('validate(cart: Cart): Result<Cart>', 'Reject carts with unknown or discontinued items', {
          calls: ['Products.get'],
          tests: ['accepts a normal cart', 'rejects an unknown product', 'rejects a discontinued product', 'reports every problem at once'],
        }),
      ],
    });
    d.block('Pricing', {
      summary: 'Works out what an order costs',
      path: 'src/orders/pricing.ts',
      usesTypes: ['Money'],
      ops: [
        op('total(cart: Cart): Money', 'Total a cart including tax and discounts', {
          calls: ['Pricing.linePrice', 'Pricing.tax', 'Discounts.apply', 'Money.add'],
          tests: ['adds every line', 'applies discounts before tax', 'totals an empty cart to zero', 'rounds half up'],
        }),
        op('linePrice(item: LineItem): Money', 'Price one line', {
          calls: ['Products.price', 'Money.multiply'],
          tests: ['multiplies price by quantity', 'uses the current price'],
        }),
        op('tax(amount: Money, region: Region): Money', '~', { tests: ['charges nothing in a tax-free region', 'uses the regional rate', 'never taxes a negative amount', 'rounds to the cent'] }),
      ],
    });
    d.block('Discounts', {
      summary: 'Applies promotions and coupon codes',
      path: 'src/orders/discounts.ts',
      ran: false,
      notes: ['◦ Stacks at most two promotions'],
      ops: [
        op('apply(cart: Cart, subtotal: Money): Money', 'Apply every promotion the cart qualifies for', {
          calls: ['Money.subtract', 'Clock.now'],
          tests: ['applies a percentage promotion', 'ignores an expired promotion', 'never discounts below zero'],
        }),
        op('redeem(code: string, customer: CustomerId): Promotion', 'Redeem a single-use coupon', {
          calls: ['Clock.now'],
          tests: ['redeems a valid code', 'refuses a code used before', 'refuses an unknown code'],
        }),
      ],
    });
    d.block('OrderRepository', {
      summary: 'Stores orders',
      path: 'src/orders/order-repository.ts',
      ops: [
        op('save(order: Order): Promise<void>', '~', { tests: ['stores a new order', 'overwrites by id'] }),
        op('find(id: OrderId): Promise<Order | undefined>', '~', { tests: ['finds a stored order'] }),
        op('byCustomer(customer: CustomerId): Promise<Order[]>', '~', { tests: ["returns only that customer's orders"] }),
        op('nextId(): OrderId', '~', { calls: ['Ids.next'], tests: ['never repeats'] }),
      ],
    });
    d.block('OrderEvents', {
      summary: 'Announces what happened to an order',
      path: 'src/orders/order-events.ts',
      ops: [
        op('placed(order: Order): void', 'Announce that an order was placed', {
          calls: ['EventBus.publish'],
          events: { 'Fulfillment.onOrderPlaced': 'order.placed' },
          tests: ['publishes order.placed'],
        }),
        op('cancelled(order: Order, reason: string): void', 'Announce that an order was cancelled', {
          calls: ['EventBus.publish'],
          events: { 'Reservations.release': 'order.cancelled' },
          tests: ['publishes order.cancelled with the reason'],
        }),
        op('shipped(order: Order): void', 'Announce that an order shipped', { calls: ['EventBus.publish'], tests: ['publishes order.shipped'] }),
      ],
    });
    d.block('Fulfillment', {
      summary: 'Gets paid orders out of the door',
      path: 'src/orders/fulfillment.ts',
      ops: [
        op('onOrderPlaced(event: OrderPlaced): Promise<void>', 'Start picking when an order is placed', {
          calls: ['Reservations.commit'],
          tests: ['commits the reservation', '-prints a packing slip'],
        }),
        op('markShipped(id: OrderId, tracking: string): Promise<Order>', 'Record a shipment and its tracking number', {
          calls: ['OrderRepository.find', 'OrderRepository.save', 'OrderEvents.shipped'],
          tests: ['stores the tracking number', 'refuses an order that was cancelled'],
        }),
      ],
    });
  });

  d.area('Inventory', () => {
    d.block('Inventory', {
      summary: 'Tracks stock and reservations',
      path: 'src/inventory/index.ts',
      data: ['interface Reservation', 'type Sku', 'type IdempotencyKey'],
      notes: ['◦ Rejects the whole order if any item is short', '◦ Ignores a repeated request with the same key'],
      ops: [
        op('reserve(orderId: OrderId, items: LineItem[], key: IdempotencyKey): Promise<Reservation>', 'Reserve stock for an order', {
          calls: ['Inventory.lockFor', 'Reservations.hold', 'StockStore.read'],
          tests: [
            'reserves every item',
            'rejects a partial order',
            'ignores a repeated request',
            'reports which items are short',
            'holds nothing when one item is short',
            'survives two orders racing for the last unit',
            'reserves across several products',
          ],
        }),
        op('release(reservationId: ReservationId): Promise<void>', 'Release a reservation', {
          calls: ['Reservations.release'],
          tests: ['returns the stock', 'ignores an unknown reservation', 'releases only once', 'releases every item', 'keeps other reservations'],
        }),
        op('available(sku: Sku): Promise<number>', 'Report availability', { calls: ['StockStore.read', 'Reservations.heldFor'] }),
        op('adjust(sku: Sku, delta: number, reason: string): Promise<void>', 'Adjust stock by hand, with a reason', {
          calls: ['Inventory.lockFor', 'StockStore.write', 'StockAlerts.check'],
        }),
        op('snapshot(): Promise<StockReport>', 'Report stock for every product', { calls: ['Inventory.available', 'StockStore.read'] }),
        op('lockFor(sku: Sku): Mutex', '~', { internal: true }),
      ],
    });
    d.block('Reservations', {
      summary: 'Holds stock for orders that have not shipped',
      path: 'src/inventory/reservations.ts',
      ops: [
        op('hold(orderId: OrderId, items: LineItem[], key: IdempotencyKey): Promise<Reservation>', 'Hold stock against an order', {
          calls: ['StockStore.read', 'StockStore.write', 'MemoryStockStore.write', 'SupabaseStockStore.write', 'Clock.now', 'Ids.next'],
          via: { 'MemoryStockStore.write': 'via StockStore', 'SupabaseStockStore.write': 'via StockStore' },
          tests: ['holds each item', 'holds nothing if any item is short', 'returns the first hold for a repeated key'],
        }),
        op('release(id: ReservationId): Promise<void>', 'Give held stock back', { calls: ['StockStore.write'], tests: ['gives the units back', 'is safe to repeat'] }),
        op('commit(orderId: OrderId): Promise<void>', 'Turn a hold into a permanent deduction', {
          calls: ['StockStore.write'],
          tests: ['deducts the held units', 'fails without a hold'],
        }),
        op('heldFor(sku: Sku): number', 'Count units currently on hold', { tests: ['counts across orders', 'is zero for an unknown product'] }),
        op('expire(now: Date): Promise<number>', 'Release holds older than fifteen minutes', {
          calls: ['Clock.now', 'StockStore.write'],
          tests: ['releases an old hold', 'keeps a fresh hold'],
        }),
      ],
    });
    d.block('Restock', {
      summary: 'Records deliveries of new stock',
      path: 'src/inventory/restock.ts',
      ops: [
        op('receive(delivery: Delivery): Promise<void>', 'Add a delivery to stock', {
          calls: ['StockStore.write', 'StockAlerts.check', 'EventBus.publish'],
          tests: ['adds the delivered units', 'rejects a negative quantity', 'announces the delivery'],
        }),
        op('planReorder(sku: Sku): number', '◦ Suggests how many units to reorder from recent sales', { calls: ['StockStore.read'], tests: ['suggests nothing while stock is high'] }),
      ],
    });
    d.block('StockAlerts', {
      summary: 'Warns when stock runs low',
      path: 'src/inventory/stock-alerts.ts',
      ran: false,
      ops: [
        op('check(sku: Sku): Promise<void>', 'Raise an alert when stock falls below its threshold', {
          calls: ['StockStore.read', 'EventBus.publish'],
          tests: ['alerts below the threshold', 'stays quiet above it'],
        }),
        op('setThreshold(sku: Sku, units: number): void', '~', { tests: ['rejects a negative threshold'] }),
      ],
    });
    d.area('Stores', () => {
      d.block('StockStore', {
        summary: 'The contract every stock backend implements',
        path: 'src/inventory/stores/stock-store.ts',
        data: ['interface StockStore', 'interface StockLevel'],
        looseTests: [
          { title: 'every store reads what it wrote', via: 'name' },
          { title: 'every store refuses a stale write', via: 'name' },
        ],
        ops: [
          op('read(sku: Sku): Promise<StockLevel>', 'Read the stock level for a product'),
          op('write(sku: Sku, level: number, version: number): Promise<boolean>', 'Write a stock level if nobody else changed it first'),
        ],
      });
      d.block('MemoryStockStore', {
        summary: 'Keeps stock in memory, for tests and demos',
        path: 'src/inventory/stores/memory-stock-store.ts',
        ops: [
          op('read(sku: Sku): Promise<StockLevel>', '~', { tests: ['reads zero for an unknown product', 'reads what was written'] }),
          op('write(sku: Sku, level: number, version: number): Promise<boolean>', '~', { tests: ['refuses a stale version', 'bumps the version'] }),
          op('reset(): void', 'Forget everything, between tests', { tests: ['empties the store'] }),
        ],
      });
      d.block('SupabaseStockStore', {
        summary: 'Keeps stock in the Supabase test database',
        path: 'src/inventory/stores/supabase-stock-store.ts',
        uses: ['@supabase/supabase-js'],
        notes: ['◦ Retries a write once when the version check fails'],
        ops: [
          op('read(sku: Sku): Promise<StockLevel>', '~', { calls: ['Config.get'], tests: ['-reads a seeded row', 'maps a missing row to zero'] }),
          op('write(sku: Sku, level: number, version: number): Promise<boolean>', '~', {
            calls: ['Config.get'],
            tests: ['-writes a new level', '-refuses a stale version'],
          }),
        ],
      });
    });
  });

  d.area('Catalog', () => {
    d.block('Catalog', {
      summary: 'What the shop sells',
      path: 'src/catalog/index.ts',
      data: ['interface Product', 'interface Page<T>'],
      ops: [
        op('list(page: PageRequest): Promise<Page<Product>>', 'List products, a page at a time', {
          calls: ['ProductRepository.page'],
          tests: ['returns one page', 'reports the total', 'skips discontinued products'],
        }),
        op('get(sku: Sku): Promise<Product>', 'Look up one product', {
          calls: ['ProductRepository.find', 'Images.urlFor'],
          tests: ['returns the product', 'fails for an unknown product'],
        }),
        op('publish(draft: ProductDraft): Promise<Product>', 'Publish a new product', {
          calls: ['Products.validate', 'ProductRepository.save', 'Search.index', 'EventBus.publish'],
          tests: ['saves a valid draft', 'rejects an invalid draft', 'makes the product searchable'],
        }),
        op('discontinue(sku: Sku): Promise<void>', 'Stop selling a product without deleting it', {
          calls: ['ProductRepository.find', 'ProductRepository.save'],
          tests: ['keeps the product on old orders'],
        }),
      ],
    });
    d.block('Products', {
      summary: 'Rules about a single product',
      path: 'src/catalog/products.ts',
      usesTypes: ['Money', 'Result'],
      ops: [
        op('get(sku: Sku): Product', '~', { calls: ['ProductRepository.find'], tests: ['returns the product', 'throws for an unknown product'] }),
        op('price(sku: Sku): Money', 'Current price of a product', { calls: ['Money.of'], tests: ['returns the list price', 'uses the sale price during a sale'] }),
        op('validate(draft: ProductDraft): Result<Product>', 'Check a product draft before it is published', {
          calls: ['Categories.exists'],
          tests: ['requires a name', 'requires a positive price', 'requires a known category'],
        }),
      ],
    });
    d.block('Categories', {
      summary: 'Groups products into a tree',
      path: 'src/catalog/categories.ts',
      ops: [
        op('exists(id: CategoryId): boolean', '~', { tests: ['knows a seeded category'] }),
        op('children(id: CategoryId): Category[]', '~', { tests: ['lists direct children', 'is empty for a leaf'] }),
        op('move(id: CategoryId, parent: CategoryId): void', 'Move a category, refusing cycles', {
          tests: ['moves a subtree', 'refuses to move under itself', 'refuses an unknown parent'],
        }),
      ],
    });
    d.block('Search', {
      summary: 'Finds products by text',
      path: 'src/catalog/search.ts',
      gaps: ['dynamic-import'],
      notes: ['◦ Ignores accents and letter case'],
      ops: [
        op('query(text: string, page: PageRequest): Page<Product>', 'Rank products against a search phrase', {
          tests: ['ranks a name match first', 'matches part of a word', 'returns nothing for nonsense'],
        }),
        op('index(product: Product): void', 'Add or update a product in the index', { tests: ['replaces the old entry', 'indexes the description'] }),
      ],
    });
    d.block('ProductRepository', {
      summary: 'Stores products',
      path: 'src/catalog/product-repository.ts',
      ops: [
        op('find(sku: Sku): Product | undefined', '~', { tests: ['finds a stored product'] }),
        op('save(product: Product): void', '~', { tests: ['stores a product', 'overwrites by sku'] }),
        op('page(request: PageRequest): Page<Product>', '~', { tests: ['pages in a stable order'] }),
      ],
    });
    d.block('Images', {
      summary: 'Product photos',
      path: 'src/catalog/images.ts',
      ops: [
        op('urlFor(sku: Sku, size: ImageSize): string', 'Build the URL of a product photo at a given size', { calls: ['Config.get'] }),
        op('upload(sku: Sku, file: Uint8Array): Promise<string>', 'Store a new photo'),
      ],
    });
  });

  d.area('Payments', () => {
    d.block('Payments', {
      summary: 'Charges and refunds customers',
      path: 'src/payments/index.ts',
      notes: ['▪ Never store card numbers'],
      data: ['interface Payment', 'type PaymentId'],
      usesTypes: ['Money'],
      ops: [
        op('charge(customer: CustomerId, amount: Money, orderId: OrderId): Promise<Payment>', 'Charge a customer for an order', {
          calls: ['PaymentGateway.authorize', 'PaymentGateway.capture', 'StubProvider.authorize', 'StripeProvider.authorize', 'Ledger.record'],
          via: { 'StubProvider.authorize': 'via PaymentGateway', 'StripeProvider.authorize': 'via PaymentGateway' },
          tests: ['captures an authorized charge', 'fails cleanly when declined', 'records the charge in the ledger', 'refuses a zero amount', 'never charges the same order twice'],
        }),
        op('status(id: PaymentId): Promise<PaymentStatus>', 'Report where a payment stands', { tests: ['reports captured', 'reports refunded', 'fails for an unknown payment'] }),
      ],
    });
    d.block('Refunds', {
      summary: 'Gives money back',
      path: 'src/payments/refunds.ts',
      ops: [
        op('refund(orderId: OrderId, amount: Money | undefined, reason: string): Promise<Refund>', 'Refund all or part of an order', {
          calls: ['PaymentGateway.refund', 'Ledger.record', 'Refunds.eligible'],
          tests: ['refunds the full amount by default', 'refunds part of an order', '!refuses to refund more than was paid', 'records the refund in the ledger'],
        }),
        op('eligible(order: Order): boolean', 'Decide whether an order can still be refunded', {
          calls: ['Clock.now'],
          tests: ['allows a refund inside thirty days', 'refuses after thirty days'],
        }),
      ],
    });
    d.block('Ledger', {
      summary: 'An append-only record of money movement',
      path: 'src/payments/ledger.ts',
      usesTypes: ['Money'],
      ops: [
        op('record(entry: LedgerEntry): void', 'Append an entry; never edit one', { calls: ['Ids.next', 'Clock.now'], tests: ['appends an entry', 'stamps the time', 'refuses to overwrite'] }),
        op('balance(account: AccountId): Money', 'Sum an account', { calls: ['Money.add'], tests: ['sums charges and refunds', 'is zero for a new account'] }),
      ],
    });
    d.block('Webhooks', {
      summary: 'Receives callbacks from the payment provider',
      path: 'src/payments/webhooks.ts',
      coverage: 'opaque',
      gaps: ['dynamic-call', 'untyped', 'unsupported'],
      ran: false,
      uses: ['node:crypto'],
      ops: [
        op('handle(req: Request): Promise<Response>', "Verify a callback's signature, then apply it", {
          calls: ['Ledger.record', 'Config.get'],
          tests: ['rejects a bad signature', 'applies a capture callback'],
        }),
      ],
    });
    d.area('Providers', () => {
      d.block('PaymentGateway', {
        summary: 'The contract every payment provider implements',
        path: 'src/payments/providers/gateway.ts',
        data: ['interface PaymentGateway', 'interface Authorization'],
        ops: [
          op('authorize(customer: CustomerId, amount: Money): Promise<Authorization>', 'Ask the provider to hold an amount'),
          op('capture(authorization: Authorization): Promise<Payment>', 'Take the held amount'),
          op('refund(payment: Payment, amount: Money): Promise<Refund>', 'Send money back'),
        ],
      });
      d.block('StubProvider', {
        summary: 'A fake provider that approves everything under 1,000',
        path: 'src/payments/providers/stub.ts',
        tags: ['stub'],
        ops: [
          op('authorize(customer: CustomerId, amount: Money): Promise<Authorization>', '~', { tests: ['approves a small amount', 'declines 1,000 and over'] }),
          op('capture(authorization: Authorization): Promise<Payment>', '~', { tests: ['captures once'] }),
          op('refund(payment: Payment, amount: Money): Promise<Refund>', '~', { tests: ['refunds a captured payment'] }),
        ],
      });
      d.block('StripeProvider', {
        summary: 'Talks to Stripe',
        path: 'src/payments/providers/stripe.ts',
        uses: ['stripe'],
        ran: false,
        notes: ['◦ Retries once on a timeout'],
        ops: [
          op('authorize(customer: CustomerId, amount: Money): Promise<Authorization>', '~', { calls: ['Config.get'], tests: ['creates a payment intent'] }),
          op('capture(authorization: Authorization): Promise<Payment>', '~', { tests: ['captures the intent'] }),
          op('refund(payment: Payment, amount: Money): Promise<Refund>', '~', { tests: ['creates a refund'] }),
        ],
      });
    });
  });

  d.area('Shared', () => {
    d.block('Money', {
      summary: 'Amounts of money that cannot be mixed across currencies',
      path: 'src/shared/money.ts',
      data: ['interface Money', 'type Currency'],
      ops: [
        op('of(amount: number, currency: Currency): Money', 'Make an amount from a number of cents', { tests: ['rejects fractions of a cent'] }),
        op('add(a: Money, b: Money): Money', 'Add two amounts of the same currency', { tests: ['adds cents', 'refuses mixed currencies'] }),
        op('subtract(a: Money, b: Money): Money', '~', { tests: ['subtracts cents', 'may go negative'] }),
        op('multiply(a: Money, factor: number): Money', 'Multiply, rounding half up', { tests: ['rounds half up', 'multiplies by zero'] }),
        op('format(a: Money, locale: string): string', 'Print an amount for a locale', { tests: ['prints US dollars', 'prints euros'] }),
      ],
    });
    d.block('Ids', {
      summary: 'Makes identifiers',
      path: 'src/shared/ids.ts',
      uses: ['node:crypto'],
      ops: [op('next(prefix: string): string', 'Make an identifier that sorts by creation time', { tests: ['keeps the prefix', 'sorts by time'] })],
    });
    d.block('Clock', {
      summary: 'The one place that reads the time',
      path: 'src/shared/clock.ts',
      ops: [
        op('now(): Date', '~', { tests: ['returns the frozen time in tests'] }),
        op('freeze(at: Date): void', 'Stop the clock, for tests', { tests: ['thaws afterwards'] }),
      ],
    });
    d.block('Result', {
      summary: 'Success or failure without exceptions',
      path: 'src/shared/result.ts',
      data: ['type Result<T>'],
      ops: [
        op('ok<T>(value: T): Result<T>', '~', { tests: ['wraps a value'] }),
        op('fail<T>(problems: Problem[]): Result<T>', '~', { tests: ['keeps every problem'] }),
        op('map<T, U>(result: Result<T>, fn: (value: T) => U): Result<U>', 'Transform a success, pass a failure through', {
          tests: ['maps a success', 'skips a failure'],
        }),
        op('unwrap<T>(result: Result<T>): T', 'Return the value or throw the failure', { tests: ['throws on failure'] }),
      ],
    });
    d.block('EventBus', {
      summary: 'Passes events between areas without coupling them',
      path: 'src/shared/event-bus.ts',
      ops: [
        op('publish(event: DomainEvent): void', 'Deliver an event to every subscriber', {
          calls: ['Logger.info'],
          tests: ['delivers to every subscriber', 'keeps going when one subscriber throws', 'delivers in subscription order'],
        }),
        op('subscribe(type: string, handler: Handler): Unsubscribe', 'Listen for one type of event', {
          tests: ['receives matching events', 'ignores other types', 'stops after unsubscribing'],
        }),
      ],
    });
    d.block('Config', {
      summary: 'Reads settings from the environment',
      path: 'src/shared/config.ts',
      uses: ['zod'],
      ops: [
        op('load(): Config', 'Read and validate every setting at startup', { tests: ['fails fast on a missing setting', 'applies defaults'] }),
        op('get(key: ConfigKey): string', '~', { tests: ['returns a loaded setting'] }),
      ],
    });
    d.block('Logger', {
      summary: 'Structured logs',
      path: 'src/shared/logger.ts',
      uses: ['pino'],
      ops: [op('info(message: string, fields?: Fields): void', '~'), op('error(message: string, error: unknown): void', '~')],
    });
  });

  return d.build();
}
