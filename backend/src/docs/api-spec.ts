export const APISpecification = {
  projectName: "DHUKNOO Ride (Ojek Batu - Malang Raya)",
  version: "1.0.0",
  architecture: "Domain Driven Design & Clean Architecture Modular",
  endpoints: [
    {
      path: "/api/auth/register",
      method: "POST",
      access: "Public",
      description: "Registers a new CUSTOMER or DRIVER account"
    },
    {
      path: "/api/auth/login",
      method: "POST",
      access: "Public",
      description: "Authenticates credentials and returns JWT"
    },
    {
      path: "/api/auth/refresh",
      method: "POST",
      access: "Public",
      description: "Returns a new Access Token using Refresh Token"
    },
    {
      path: "/api/auth/profile",
      method: "GET",
      access: "Authenticated",
      description: "Returns the authenticated user details"
    },
    {
      path: "/api/auth/change-password",
      method: "POST",
      access: "Authenticated",
      description: "Allows users to rotate credentials"
    },
    {
      path: "/api/admin/dashboard",
      method: "GET",
      access: "Admin Only",
      description: "Accesses global statistics and driver statuses"
    },
    {
      path: "/api/driver/jobs",
      method: "GET",
      access: "Driver Only",
      description: "Lists active ride opportunities"
    }
  ]
};
