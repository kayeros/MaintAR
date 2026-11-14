using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using Resend;
using MaintARBackend.Context;
using MaintARBackend.Middleware;
using MaintARBackend.Services.Auth;
using MaintARBackend.Services.Email;

var builder = WebApplication.CreateBuilder(args);

// Локальные секреты (ключи JWT и Resend). Файл не попадает в git.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

// Add services to the container.

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
// Провайдер БД: по умолчанию SQL Server; "Database:Provider": "Sqlite" — для локального запуска без LocalDB.
var useSqlite = string.Equals(builder.Configuration["Database:Provider"], "Sqlite", StringComparison.OrdinalIgnoreCase);
builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (useSqlite)
        options.UseSqlite(builder.Configuration.GetConnectionString("Sqlite") ?? "Data Source=maintar.db");
    else
        options.UseSqlServer(builder.Configuration.GetConnectionString("Default"));
});
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IPasswordService, PasswordService>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<IPasswordResetService, PasswordResetService>();
builder.Services.AddScoped<IEmailVerificationService, EmailVerificationService>();
builder.Services.AddScoped<IEmailService, EmailService>();

// Наш ИИ-сервер, адрес в appsettings (AiService:BaseUrl).
builder.Services.AddHttpClient<MaintARBackend.Services.Ai.IAiAnalysisClient, MaintARBackend.Services.Ai.AiAnalysisClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["AiService:BaseUrl"] ?? "http://localhost:8000/");
    client.Timeout = TimeSpan.FromSeconds(60);
});

var resendToken = builder.Configuration["Resend:ApiToken"];
if (string.IsNullOrWhiteSpace(resendToken))
    throw new InvalidOperationException("Resend:ApiToken не задан (user-secrets)");
builder.Services.AddResend(resendToken);

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateAudience = true,
            ValidAudience = builder.Configuration["Jwt:Audience"],
            ValidateLifetime = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)),
            ValidateIssuerSigningKey = true,
        };
    });

// Доступ к рабочему функционалу только с подтверждённой почтой.
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("EmailVerified", policy => policy.RequireClaim("email_verified", "true"));
});

// Веб-версия приложения (Expo web) обращается к API с другого порта: в разработке разрешаем любой источник.
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "Bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Вставь сюда только сам токен, без слова Bearer — Swagger добавит его сам"
    });

    options.AddSecurityRequirement(document => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", document)] = []
    });
});

var app = builder.Build();

app.UseMiddleware<ExceptionHandlingMiddleware>();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    using (var scope = app.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // Миграции написаны под SQL Server, поэтому для SQLite схема создаётся по модели.
        if (useSqlite)
            await db.Database.EnsureCreatedAsync();
        await DevDataSeeder.SeedAsync(db);
    }

    app.UseCors();
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

// Фото оборудования из wwwroot/uploads.
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
