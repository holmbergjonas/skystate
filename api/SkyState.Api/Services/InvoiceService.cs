using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using SkyState.Api.Models;
using SkyState.Api.Repositories;

namespace SkyState.Api.Services;

public interface IInvoiceService
{
    Task<Invoice?> GetByIdAsync(Guid userId, Guid invoiceId);
    Task<IEnumerable<Invoice>> GetByUserIdAsync(Guid userId);
}

public class InvoiceService(IInvoiceRepository invoiceRepo) : IInvoiceService
{

    public async Task<Invoice?> GetByIdAsync(Guid userId, Guid invoiceId)
    {
        return await invoiceRepo.GetByIdAsync(userId, invoiceId);
    }

    public async Task<IEnumerable<Invoice>> GetByUserIdAsync(Guid userId)
    {
        return await invoiceRepo.GetByUserIdAsync(userId);
    }
}
