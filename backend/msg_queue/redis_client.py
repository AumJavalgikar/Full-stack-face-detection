import redis


class RedisClient:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialize(*args, **kwargs)
        return cls._instance

    def _initialize(
        self,
        host="localhost",
        port=6379,
        db=0,
        password=None,
        max_connections=50,
        decode_responses=True,
    ):
        self._pool = redis.ConnectionPool(
            host=host,
            port=port,
            db=db,
            password=password,
            max_connections=max_connections,
            decode_responses=decode_responses,
        )

    def get_client(self):
        return redis.Redis(connection_pool=self._pool)