const Order = require("../../models/order");

const getOrderStatus = async ({
  orderId,
  userEmail,
  userPhoneNumber,
  query,
}) => {
  console.log("ORDER ARGUMENTS:", {
    orderId,
    userEmail,
    userPhoneNumber,
    query,
  });
  const defaultAvailableStatus = ["pending", "processing", "shipped"];

  const orderQuery = {
    $and: [{ status: { $in: defaultAvailableStatus } }],
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
    ? order.map((odr) => {
        const status = () => {
          if (odr.status === "pending") {
            return "Menunggu Pembayaran";
          } else if (odr.status === "processing") {
            return "Diproses";
          } else if (odr.status === "shipped") {
            return "Dikirim";
          } else {
            return "Status Tidak Diketahui";
          }
        };
        return {
          ...odr,
          status: status(),
        };
      })
    : [];
};

module.exports = { getOrderStatus };
