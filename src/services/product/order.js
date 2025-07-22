const Order = require("../../models/order");
const mongoose = require("mongoose");

const getOrderStatus = async ({
  orderId,
  userEmail,
  userPhoneNumber,
  status,
  query,
  excludeOrderIds,
}) => {
  console.log("ORDER ARGUMENTS:", {
    orderId,
    userEmail,
    userPhoneNumber,
    query,
    status,
    excludeOrderIds,
  });
  const defaultAvailableStatus = ["pending", "processing", "shipped"];

  let validStatus;

  if (status) {
    const statusCurrently = defaultAvailableStatus.find(
      (s) => s.toLowerCase() === status.toLowerCase()
    );
    if (statusCurrently) {
      validStatus = statusCurrently;
    }
  }

  const orderQuery = {
    _id: { $nin: excludeOrderIds.map((id) => new mongoose.Types.ObjectId(id)) },
    $and: [{ status: { $in: validStatus ?? defaultAvailableStatus } }],
  };

  if (orderId) {
    orderQuery.$and.push({ orderId });
  }
  const orQuery = [];
  if (userEmail) {
    orQuery.push({ "shippingAddress.email": userEmail });
  }
  if (userPhoneNumber) {
    orQuery.push({ "shippingAddress.phoneNumber": userPhoneNumber });
  }
  if (orQuery.length > 0) {
    orderQuery.$and.push({ $or: orQuery });
  }

  const order = await Order.find(orderQuery);
  return Array.isArray(order)
    ? order.map(({ _doc }) => {
        const status = () => {
          if (_doc.status === "pending") {
            return "Menunggu Pembayaran";
          } else if (_doc.status === "processing") {
            return "Diproses";
          } else if (_doc.status === "shipped") {
            return "Dikirim";
          } else {
            return "Status Tidak Diketahui";
          }
        };
        return {
          ..._doc,
          status: status(),
        };
      })
    : [];
};

const requestCancelOrder = async ({ query, status, orderIds }) => {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return [];
  }
  const orders = await Order.find({
    orderId: { $in: orderIds },
    $nor: [
      {
        status: "cancel-requested",
      },
      {
        status: "delivered",
      },
      {
        status: "cancelled",
      },
    ],
  });
  return Array.isArray(orders)
    ? orders.map(({ _doc }) => {
        const status = () => {
          if (_doc.status === "pending") {
            return "Menunggu Pembayaran";
          } else if (_doc.status === "processing") {
            return "Diproses";
          } else if (_doc.status === "shipped") {
            return "Dikirim";
          } else {
            return "Status Tidak Diketahui";
          }
        };
        return {
          ..._doc,
          status: status(),
        };
      })
    : [];
};

module.exports = { getOrderStatus, requestCancelOrder };
