using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MaintARBackend.Context;
using MaintARBackend.Services.Auth;

namespace MaintARBackend.Controllers
{
    public class UpdateNameModel
    {
        [Required]
        [StringLength(50, MinimumLength = 1)]
        public required string UserName { get; set; }
    }

    // Профиль пользователя: имя и аватарка.
    // Аватарка хранится файлом wwwroot/uploads/avatars/{id}.jpg — без колонки в БД,
    // чтобы не менять схему (SQLite создаётся через EnsureCreated и не обновляется миграциями).
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ProfileController : ControllerBase
    {
        private const long MaxAvatarSize = 5 * 1024 * 1024;

        private readonly AppDbContext _db;
        private readonly IWebHostEnvironment _env;
        private readonly IJwtTokenService _jwtTokenService;

        public ProfileController(AppDbContext db, IWebHostEnvironment env, IJwtTokenService jwtTokenService)
        {
            _db = db;
            _env = env;
            _jwtTokenService = jwtTokenService;
        }

        [HttpGet]
        public async Task<IActionResult> Get()
        {
            var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == GetUserId());
            if (user == null)
            {
                return NotFound("User not found");
            }

            return Ok(new { user.UserName, user.Email, AvatarUrl = GetAvatarUrl(user.Id) });
        }

        // Новое имя попадает и в токен, поэтому возвращаем новый токен.
        [HttpPut("name")]
        public async Task<IActionResult> UpdateName([FromBody] UpdateNameModel model)
        {
            var name = model.UserName?.Trim() ?? string.Empty;
            if (name.Length == 0 || name.Length > 50)
            {
                return BadRequest("Name must be between 1 and 50 characters");
            }

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == GetUserId());
            if (user == null)
            {
                return NotFound("User not found");
            }

            user.UserName = name;
            await _db.SaveChangesAsync();

            var token = _jwtTokenService.GenerateToken(
                user.Id.ToString(),
                user.UserName,
                [new Claim("email_verified", user.IsEmailVerified ? "true" : "false")]);

            return Ok(new { user.UserName, Token = token });
        }

        [HttpPost("avatar")]
        [RequestSizeLimit(MaxAvatarSize + 1024 * 1024)]
        public async Task<IActionResult> UploadAvatar(IFormFile photo)
        {
            if (photo == null || photo.Length == 0 || photo.Length > MaxAvatarSize)
            {
                return BadRequest("Photo must be between 1 byte and 5 MB");
            }

            if (!photo.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest("File must be an image");
            }

            var path = AvatarFile(GetUserId());
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using (var stream = System.IO.File.Create(path))
            {
                await photo.CopyToAsync(stream);
            }

            return Ok(new { AvatarUrl = GetAvatarUrl(GetUserId()) });
        }

        [HttpDelete("avatar")]
        public IActionResult DeleteAvatar()
        {
            var path = AvatarFile(GetUserId());
            if (System.IO.File.Exists(path))
            {
                System.IO.File.Delete(path);
            }

            return NoContent();
        }

        private string AvatarFile(int userId)
        {
            var root = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
            return Path.Combine(root, "uploads", "avatars", $"{userId}.jpg");
        }

        // ?v= — время изменения файла, чтобы приложение не показывало старую картинку из кэша.
        private string? GetAvatarUrl(int userId)
        {
            var path = AvatarFile(userId);
            return System.IO.File.Exists(path)
                ? $"/uploads/avatars/{userId}.jpg?v={System.IO.File.GetLastWriteTimeUtc(path).Ticks}"
                : null;
        }

        private int GetUserId()
        {
            return int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        }
    }
}
