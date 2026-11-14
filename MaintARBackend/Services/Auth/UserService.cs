using Microsoft.EntityFrameworkCore;
using MaintARBackend.Context;

namespace MaintARBackend.Services.Auth;

public interface IUserService
{
    Task<bool> EmailExistsAsync(string email);
}

internal sealed class UserService : IUserService
{
    private readonly AppDbContext _db;

    public UserService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<bool> EmailExistsAsync(string email)
    {
        return await _db.Users.AnyAsync(u => u.Email == email);
    }
}
