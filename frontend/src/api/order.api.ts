import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const OrderAPI = {

  accept: async (orderId: string) =>
    (
      await api.patch(
        API_ENDPOINTS.order.accept(orderId)
      )
    ).data,

  updateStatus: async (
    orderId: string,
    status: string
  ) =>
    (
      await api.patch(
        API_ENDPOINTS.order.updateStatus(orderId),
        { status }
      )
    ).data,

  getChatHistory: async (orderId: string) =>
    (
      await api.get(
        API_ENDPOINTS.order.chatHistory(orderId)
      )
    ).data.messages,

};