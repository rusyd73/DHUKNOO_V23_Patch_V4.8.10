-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_action_createdAt_idx" ON "ActivityLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_senderId_createdAt_idx" ON "ChatMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerProfile_phoneNumber_idx" ON "CustomerProfile"("phoneNumber");

-- CreateIndex
CREATE INDEX "CustomerProfile_userId_idx" ON "CustomerProfile"("userId");

-- CreateIndex
CREATE INDEX "DriverDocument_driverId_status_idx" ON "DriverDocument"("driverId", "status");

-- CreateIndex
CREATE INDEX "DriverDocument_status_createdAt_idx" ON "DriverDocument"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DriverProfile_isOnline_isVerified_serviceType_idx" ON "DriverProfile"("isOnline", "isVerified", "serviceType");

-- CreateIndex
CREATE INDEX "DriverProfile_isOnline_latitude_longitude_idx" ON "DriverProfile"("isOnline", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "DriverProfile_isVerified_isOnline_idx" ON "DriverProfile"("isVerified", "isOnline");

-- CreateIndex
CREATE INDEX "DriverProfile_serviceType_isOnline_idx" ON "DriverProfile"("serviceType", "isOnline");

-- CreateIndex
CREATE INDEX "DriverProfile_userId_idx" ON "DriverProfile"("userId");

-- CreateIndex
CREATE INDEX "DriverProfile_vehiclePlate_idx" ON "DriverProfile"("vehiclePlate");

-- CreateIndex
CREATE INDEX "Merchant_name_idx" ON "Merchant"("name");

-- CreateIndex
CREATE INDEX "Merchant_category_isOpen_idx" ON "Merchant"("category", "isOpen");

-- CreateIndex
CREATE INDEX "Merchant_latitude_longitude_idx" ON "Merchant"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Merchant_ownerId_idx" ON "Merchant"("ownerId");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_driverId_status_idx" ON "Order"("driverId", "status");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_merchantId_status_createdAt_idx" ON "Order"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_paymentMethod_isPaid_idx" ON "Order"("paymentMethod", "isPaid");

-- CreateIndex
CREATE INDEX "Order_status_driverId_createdAt_idx" ON "Order"("status", "driverId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_pickupLat_pickupLng_idx" ON "Order"("pickupLat", "pickupLng");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_serviceType_status_idx" ON "Order"("serviceType", "status");

-- CreateIndex
CREATE INDEX "Order_acceptedAt_idx" ON "Order"("acceptedAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "PaymentProof_status_createdAt_idx" ON "PaymentProof"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentProof_orderId_idx" ON "PaymentProof"("orderId");

-- CreateIndex
CREATE INDEX "PricingHistory_orderId_idx" ON "PricingHistory"("orderId");

-- CreateIndex
CREATE INDEX "PricingHistory_tariffVersionId_idx" ON "PricingHistory"("tariffVersionId");

-- CreateIndex
CREATE INDEX "PricingHistory_createdAt_idx" ON "PricingHistory"("createdAt");

-- CreateIndex
CREATE INDEX "PricingRule_serviceType_isActive_idx" ON "PricingRule"("serviceType", "isActive");

-- CreateIndex
CREATE INDEX "PricingRule_effectiveFrom_idx" ON "PricingRule"("effectiveFrom");

-- CreateIndex
CREATE INDEX "PricingZone_name_idx" ON "PricingZone"("name");

-- CreateIndex
CREATE INDEX "PricingZone_isActive_idx" ON "PricingZone"("isActive");

-- CreateIndex
CREATE INDEX "Product_merchantId_isAvailable_idx" ON "Product"("merchantId", "isAvailable");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_merchantId_createdAt_idx" ON "Product"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Promo_code_idx" ON "Promo"("code");

-- CreateIndex
CREATE INDEX "Promo_isActive_expiresAt_idx" ON "Promo"("isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "RegionalPolicy_zoneId_isActive_idx" ON "RegionalPolicy"("zoneId", "isActive");

-- CreateIndex
CREATE INDEX "Review_driverId_rating_idx" ON "Review"("driverId", "rating");

-- CreateIndex
CREATE INDEX "Review_orderId_idx" ON "Review"("orderId");

-- CreateIndex
CREATE INDEX "TariffVersion_isActive_idx" ON "TariffVersion"("isActive");

-- CreateIndex
CREATE INDEX "TariffVersion_createdAt_idx" ON "TariffVersion"("createdAt");

-- CreateIndex
CREATE INDEX "TopupRequest_status_createdAt_idx" ON "TopupRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TopupRequest_userId_status_idx" ON "TopupRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "TopupRequest_userId_createdAt_idx" ON "TopupRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TopupRequest_method_status_idx" ON "TopupRequest"("method", "status");

-- CreateIndex
CREATE INDEX "Transaction_walletId_createdAt_idx" ON "Transaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_type_createdAt_idx" ON "Transaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_orderId_idx" ON "Transaction"("orderId");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_walletId_type_idx" ON "Transaction"("walletId", "type");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE INDEX "User_isActive_createdAt_idx" ON "User"("isActive", "createdAt");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_balance_idx" ON "Wallet"("balance");
