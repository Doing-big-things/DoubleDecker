Added Inventory.reserve(orderId, items, idempotencyKey) and Inventory.release(key). Orders.placeOrder reserves stock before charging and releases it if the charge fails. All tests pass.
