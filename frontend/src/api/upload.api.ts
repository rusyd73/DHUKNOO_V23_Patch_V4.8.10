import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const UploadAPI = {
  uploadImage: async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);

    const res = await api.post(
      API_ENDPOINTS.upload.image,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    return res.data as {
      message: string;
      url: string;
    };
  },
};